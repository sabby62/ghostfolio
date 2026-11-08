import {
  RebalancingDrift,
  RebalancingGroup,
  RebalancingMode,
  RebalancingPlan
} from '@ghostfolio/client/services/rebalancing/rebalancing.interfaces';
import { RebalancingService } from '@ghostfolio/client/services/rebalancing/rebalancing.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { ConfirmationDialogType } from '@ghostfolio/common/enums';
import { getDateFormatString } from '@ghostfolio/common/helper';
import {
  LookupItem,
  PortfolioPosition,
  User
} from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { AccountWithValue } from '@ghostfolio/common/types';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';
import { GfSymbolAutocompleteComponent } from '@ghostfolio/ui/symbol-autocomplete';
import { GfValueComponent } from '@ghostfolio/ui/value';

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  calculatorOutline,
  checkmarkCircleOutline,
  createOutline,
  trashOutline,
  warningOutline
} from 'ionicons/icons';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

interface TargetRow {
  dataSource: string;
  name: string;
  symbol: string;
  /** In percent, e.g. 25 for 25% */
  target: number;
}

interface GroupForm {
  accountIds: string[];
  driftThreshold: number;
  id?: string;
  name: string;
  targets: TargetRow[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page' },
  imports: [
    DatePipe,
    FormsModule,
    GfSymbolAutocompleteComponent,
    GfValueComponent,
    IonIcon,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-rebalancing-page',
  styleUrls: ['./rebalancing-page.scss'],
  templateUrl: './rebalancing-page.html'
})
export class GfRebalancingPageComponent {
  protected accounts: AccountWithValue[] = [];
  protected allowFractionalShares = false;
  protected dateFormat = getDateFormatString();
  protected drift?: RebalancingDrift;
  protected readonly driftColumns = [
    'holding',
    'current',
    'target',
    'drift',
    'invested',
    'value',
    'gain'
  ];
  protected form?: GroupForm;
  protected groups: RebalancingGroup[] = [];
  protected hasPermissionToUpdate = false;
  protected holdings: PortfolioPosition[] = [];
  protected holdingToAdd?: PortfolioPosition;
  protected isCalculating = false;
  protected isLoadingDrift = false;
  protected isLoadingGroups = true;
  protected isSaving = false;
  protected mode: RebalancingMode = 'BUY_ONLY';
  protected newCash: number | null = null;
  protected plan?: RebalancingPlan;
  protected readonly searchControl = new FormControl<LookupItem | null>(null);
  protected selectedGroupId?: string;
  protected readonly tradeColumns = [
    'action',
    'holding',
    'quantity',
    'price',
    'value'
  ];
  protected user?: User;

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notificationService = inject(NotificationService);
  private readonly rebalancingService = inject(RebalancingService);
  private readonly userService = inject(UserService);

  public constructor() {
    this.userService.stateChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state?.user) {
          const isFirstUser = !this.user;

          this.user = state.user;
          this.dateFormat = getDateFormatString(this.user.settings?.locale);
          this.hasPermissionToUpdate = hasPermission(
            this.user.permissions,
            permissions.updateRebalancing
          );

          if (isFirstUser) {
            this.fetchGroups();
            this.fetchAccountsAndHoldings();
          }

          this.changeDetectorRef.markForCheck();
        }
      });

    this.searchControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lookupItem) => {
        if (lookupItem?.symbol && lookupItem.dataSource) {
          this.addTarget({
            dataSource: lookupItem.dataSource,
            name: lookupItem.name,
            symbol: lookupItem.symbol
          });

          this.searchControl.setValue(null, { emitEvent: false });
        }
      });

    addIcons({
      addOutline,
      calculatorOutline,
      checkmarkCircleOutline,
      createOutline,
      trashOutline,
      warningOutline
    });
  }

  protected get availableHoldings() {
    return this.holdings.filter(({ assetProfile }) => {
      return (
        assetProfile.assetSubClass !== 'CASH' &&
        !this.form?.targets.some(({ dataSource, symbol }) => {
          return (
            dataSource === assetProfile.dataSource &&
            symbol === assetProfile.symbol
          );
        })
      );
    });
  }

  protected get cashTarget() {
    return Math.max(0, 100 - this.targetSum);
  }

  protected get selectedGroup() {
    return this.groups.find(({ id }) => {
      return id === this.selectedGroupId;
    });
  }

  protected get targetSum() {
    return (this.form?.targets ?? []).reduce((sum, { target }) => {
      return sum + (Number(target) || 0);
    }, 0);
  }

  protected get isFormValid() {
    const form = this.form;

    return (
      !!form?.name?.trim() &&
      this.targetSum <= 100 + 1e-9 &&
      form.targets.every(({ target }) => {
        return Number(target) >= 0 && Number(target) <= 100;
      }) &&
      Number(form.driftThreshold) >= 0 &&
      Number(form.driftThreshold) <= 100
    );
  }

  protected onAddHolding() {
    const holding = this.holdingToAdd;

    if (!holding) {
      return;
    }

    this.addTarget({
      dataSource: holding.assetProfile.dataSource,
      name: holding.assetProfile.name ?? holding.assetProfile.symbol,
      symbol: holding.assetProfile.symbol
    });

    this.holdingToAdd = undefined;
  }

  protected getAccountNames(accountIds: string[]) {
    if (!accountIds?.length) {
      return $localize`All accounts`;
    }

    return accountIds
      .map((accountId) => {
        const name = this.accounts.find(({ id }) => {
          return id === accountId;
        })?.name;

        // An account can have an empty name
        if (name) {
          return name;
        }

        return accountId;
      })
      .join(', ');
  }

  protected onCalculate() {
    if (!this.selectedGroupId) {
      return;
    }

    this.isCalculating = true;

    this.rebalancingService
      .calculate({
        data: {
          allowFractionalShares: this.allowFractionalShares,
          mode: this.mode,
          newCashInBaseCurrency: Number(this.newCash) || 0
        },
        groupId: this.selectedGroupId
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isCalculating = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((plan) => {
        this.plan = plan;
      });
  }

  protected onCancelEdit() {
    this.form = undefined;
  }

  protected onCreateGroup() {
    this.form = {
      accountIds: [],
      driftThreshold: 5,
      name: '',
      targets: []
    };
  }

  protected onDeleteGroup() {
    const group = this.selectedGroup;

    if (!group) {
      return;
    }

    this.notificationService.confirm({
      confirmFn: () => {
        this.rebalancingService
          .deleteGroup(group.id)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this.showError(error);

              return EMPTY;
            }),
            takeUntilDestroyed(this.destroyRef)
          )
          .subscribe(() => {
            this.selectedGroupId = undefined;
            this.fetchGroups();
          });
      },
      confirmType: ConfirmationDialogType.Warn,
      title: $localize`Do you really want to delete the rebalancing group ${group.name}?`
    });
  }

  protected onEditGroup() {
    const group = this.selectedGroup;

    if (!group) {
      return;
    }

    this.form = {
      accountIds: [...group.accountIds],
      driftThreshold: this.toPercent(group.driftThresholdInPercentage),
      id: group.id,
      name: group.name,
      targets: group.targets.map(
        ({ dataSource, symbol, targetInPercentage }) => {
          return {
            dataSource,
            symbol,
            name: this.getHoldingName({ dataSource, symbol }),
            target: this.toPercent(targetInPercentage)
          };
        }
      )
    };
  }

  protected onRemoveTarget(index: number) {
    this.form?.targets.splice(index, 1);
  }

  protected onSaveGroup() {
    const form = this.form;

    if (!form || !this.isFormValid) {
      return;
    }

    const data = {
      accountIds: form.accountIds,
      driftThresholdInPercentage: Number(form.driftThreshold) / 100,
      name: form.name.trim(),
      targets: form.targets.map(({ dataSource, symbol, target }) => {
        return {
          dataSource,
          symbol,
          targetInPercentage: Math.round(Number(target) * 1e4) / 1e6
        };
      })
    };

    this.isSaving = true;

    const request$ = form.id
      ? this.rebalancingService.updateGroup({ data, groupId: form.id })
      : this.rebalancingService.createGroup(data);

    request$
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isSaving = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((group) => {
        this.form = undefined;
        this.selectedGroupId = group.id;
        this.fetchGroups();
      });
  }

  protected onSelectGroup(groupId: string) {
    this.selectedGroupId = groupId;
    this.plan = undefined;
    this.fetchDrift();
  }

  protected toPercent(fraction: number) {
    return Math.round((fraction ?? 0) * 1e6) / 1e4;
  }

  private addTarget({
    dataSource,
    name,
    symbol
  }: {
    dataSource: string;
    name: string;
    symbol: string;
  }) {
    const form = this.form;

    if (
      !form ||
      form.targets.some((target) => {
        return target.dataSource === dataSource && target.symbol === symbol;
      })
    ) {
      return;
    }

    form.targets.push({
      dataSource,
      name,
      symbol,
      target: Math.max(0, Math.round((100 - this.targetSum) * 100) / 100)
    });

    this.changeDetectorRef.markForCheck();
  }

  private fetchAccountsAndHoldings() {
    this.dataService
      .fetchAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ accounts }) => {
        this.accounts = accounts;
        this.changeDetectorRef.markForCheck();
      });

    this.dataService
      .fetchPortfolioHoldings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ holdings }) => {
        this.holdings = holdings ?? [];
        this.changeDetectorRef.markForCheck();
      });
  }

  private fetchDrift() {
    if (!this.selectedGroupId) {
      this.drift = undefined;

      return;
    }

    this.isLoadingDrift = true;
    this.changeDetectorRef.markForCheck();

    this.rebalancingService
      .fetchDrift(this.selectedGroupId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isLoadingDrift = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((drift) => {
        this.drift = drift;
      });
  }

  private fetchGroups() {
    this.isLoadingGroups = true;

    this.rebalancingService
      .fetchGroups()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isLoadingGroups = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((groups) => {
        this.groups = groups;

        if (
          !this.groups.some(({ id }) => {
            return id === this.selectedGroupId;
          })
        ) {
          this.selectedGroupId = this.groups[0]?.id;
        }

        this.plan = undefined;
        this.fetchDrift();
      });
  }

  private getHoldingName({
    dataSource,
    symbol
  }: {
    dataSource: string;
    symbol: string;
  }) {
    const holding = this.holdings.find(({ assetProfile }) => {
      return (
        assetProfile.dataSource === dataSource && assetProfile.symbol === symbol
      );
    });

    return (
      holding?.assetProfile.name ??
      this.drift?.positions.find((position) => {
        return position.dataSource === dataSource && position.symbol === symbol;
      })?.name ??
      symbol
    );
  }

  private showError(error: HttpErrorResponse) {
    const message = (error?.error as { message?: string | string[] })?.message;

    this.notificationService.alert({
      message: Array.isArray(message) ? message.join(', ') : message,
      title: $localize`Oops! Something went wrong.`
    });
  }
}
