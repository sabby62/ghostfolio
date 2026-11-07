import {
  SnapTradeAccount,
  SnapTradeAccountSyncResult,
  SnapTradeStatus
} from '@ghostfolio/client/services/snaptrade/snaptrade.interfaces';
import { SnapTradeService } from '@ghostfolio/client/services/snaptrade/snaptrade.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { UpdateSnapTradeAccountDto } from '@ghostfolio/common/dtos';
import { ConfirmationDialogType } from '@ghostfolio/common/enums';
import { getDateFormatString } from '@ghostfolio/common/helper';
import { User } from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { AccountWithValue } from '@ghostfolio/common/types';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';

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
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  linkOutline,
  refreshOutline,
  syncOutline,
  unlinkOutline
} from 'ionicons/icons';
import { EMPTY, Observable } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

/**
 * The option of the account selector which creates a new account
 */
const CREATE_ACCOUNT = '__create__';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    IonIcon,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-user-account-brokerages',
  styleUrls: ['./user-account-brokerages.scss'],
  templateUrl: './user-account-brokerages.html'
})
export class GfUserAccountBrokeragesComponent {
  protected accounts: AccountWithValue[] = [];
  protected readonly createAccountOption = CREATE_ACCOUNT;
  protected dateFormat: string;
  protected readonly displayedColumns = [
    'brokerageAccount',
    'account',
    'syncFromDate',
    'isSyncEnabled',
    'lastSync'
  ];
  protected hasPermissionToSync = false;
  protected isConnecting = false;
  protected isLoading = true;
  protected isSyncing = false;
  protected status: SnapTradeStatus;
  protected syncResults?: SnapTradeAccountSyncResult[];
  protected user: User;

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notificationService = inject(NotificationService);
  private readonly snapTradeService = inject(SnapTradeService);
  private readonly userService = inject(UserService);

  public constructor() {
    this.userService.stateChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state?.user) {
          const isFirstUser = !this.user;

          this.user = state.user;
          this.dateFormat = getDateFormatString(this.user.settings?.locale);
          this.hasPermissionToSync = hasPermission(
            this.user.permissions,
            permissions.createActivity
          );

          if (isFirstUser) {
            this.update({ withRefresh: true });
          }

          this.changeDetectorRef.markForCheck();
        }
      });

    addIcons({
      alertCircleOutline,
      linkOutline,
      refreshOutline,
      syncOutline,
      unlinkOutline
    });
  }

  protected getAccountName(accountId: string) {
    return (
      this.accounts.find(({ id }) => {
        return id === accountId;
      })?.name ?? ''
    );
  }

  protected getSkippedEntries(result: SnapTradeAccountSyncResult) {
    return Object.entries(result.skipped ?? {});
  }

  protected onConnect(reconnect?: string) {
    this.isConnecting = true;

    // Open the window before the request, a popup blocker allows it only in
    // the handler of the click
    const connectionWindow = window.open('', '_blank');

    this.snapTradeService
      .createConnectionLink(reconnect ? { reconnect } : {})
      .pipe(
        catchError((error: HttpErrorResponse) => {
          connectionWindow?.close();
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isConnecting = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ redirectURI }) => {
        if (connectionWindow) {
          connectionWindow.location.href = redirectURI;
        } else {
          window.location.href = redirectURI;
        }
      });
  }

  protected onDisconnect() {
    this.notificationService.confirm({
      confirmFn: () => {
        this.snapTradeService
          .deleteConnection()
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this.showError(error);

              return EMPTY;
            }),
            takeUntilDestroyed(this.destroyRef)
          )
          .subscribe(() => {
            this.syncResults = undefined;
            this.update();
          });
      },
      confirmType: ConfirmationDialogType.Warn,
      message: $localize`The imported activities and the accounts are kept.`,
      title: $localize`Do you really want to disconnect SnapTrade?`
    });
  }

  protected onLinkChange(snapTradeAccount: SnapTradeAccount, value: string) {
    if (value === CREATE_ACCOUNT) {
      this.updateAccount(snapTradeAccount, { createAccount: true }, true);
    } else {
      this.updateAccount(snapTradeAccount, { accountId: value || null });
    }
  }

  protected onRefresh() {
    this.update({ withRefresh: true });
  }

  protected onSync(snapTradeAccountIds?: string[]) {
    this.isSyncing = true;
    this.changeDetectorRef.markForCheck();

    this.snapTradeService
      .sync(snapTradeAccountIds)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isSyncing = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((syncResults) => {
        this.syncResults = syncResults;
        this.update({ withAccounts: true });
      });
  }

  protected onSyncEnabledChange(
    snapTradeAccount: SnapTradeAccount,
    isSyncEnabled: boolean
  ) {
    this.updateAccount(snapTradeAccount, { isSyncEnabled });
  }

  protected onSyncFromDateChange(
    snapTradeAccount: SnapTradeAccount,
    value: string
  ) {
    this.updateAccount(snapTradeAccount, {
      syncFromDate: value
        ? new Date(`${value}T00:00:00.000Z`).toISOString()
        : null
    });
  }

  protected toDateInputValue(date: string | null) {
    return date ? date.slice(0, 10) : '';
  }

  private showError(error: HttpErrorResponse) {
    const message = (error?.error as { message?: string | string[] })?.message;

    this.notificationService.alert({
      message: Array.isArray(message) ? message.join(', ') : message,
      title: $localize`Oops! Something went wrong with SnapTrade.`
    });
  }

  private update({
    withAccounts = true,
    withRefresh = false
  }: { withAccounts?: boolean; withRefresh?: boolean } = {}) {
    this.isLoading = true;

    if (withAccounts) {
      this.dataService
        .fetchAccounts()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(({ accounts }) => {
          this.accounts = accounts;
          this.changeDetectorRef.markForCheck();
        });
    }

    this.snapTradeService
      .fetchStatus()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((status) => {
        this.status = status;

        if (withRefresh && status.isEnabled && status.isConnected) {
          // Gives the accounts which were connected in the meantime
          this.handleAccounts(this.snapTradeService.fetchAccounts());
        } else {
          this.isLoading = false;
        }

        this.changeDetectorRef.markForCheck();
      });
  }

  private handleAccounts(accounts$: Observable<SnapTradeAccount[]>) {
    accounts$
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);

          return EMPTY;
        }),
        finalize(() => {
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((accounts) => {
        this.status = { ...this.status, accounts };
      });
  }

  private updateAccount(
    snapTradeAccount: SnapTradeAccount,
    data: UpdateSnapTradeAccountDto,
    withAccounts = false
  ) {
    this.snapTradeService
      .updateAccount({ data, snapTradeAccountId: snapTradeAccount.id })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.showError(error);
          this.update({ withAccounts: false });

          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((updatedAccount) => {
        this.status = {
          ...this.status,
          accounts: this.status.accounts.map((account) => {
            return account.id === updatedAccount.id
              ? {
                  ...updatedAccount,
                  isConnectionDisabled: account.isConnectionDisabled
                }
              : account;
          })
        };

        if (withAccounts) {
          this.update({ withAccounts: true });
        }

        this.changeDetectorRef.markForCheck();
      });
  }
}
