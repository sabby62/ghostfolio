import { GfDialogHeaderComponent } from '@ghostfolio/ui/dialog-header';
import { GfValueComponent } from '@ghostfolio/ui/value';

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';

import {
  AllocationDetailDialogParams,
  AllocationDetailDialogResult,
  AllocationDetailItem
} from './interfaces/interfaces';

/**
 * Lists the holdings which make up a category of an allocation chart, e.g.
 * which holdings give the exposure to a country
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GfDialogHeaderComponent,
    GfValueComponent,
    MatDialogModule,
    MatTableModule
  ],
  selector: 'gf-allocation-detail-dialog',
  styleUrls: ['./allocation-detail-dialog.scss'],
  templateUrl: './allocation-detail-dialog.html'
})
export class GfAllocationDetailDialogComponent {
  protected readonly data =
    inject<AllocationDetailDialogParams>(MAT_DIALOG_DATA);

  protected readonly displayedColumns = [
    'holding',
    'weight',
    'value',
    'shareOfCategory'
  ];

  protected readonly items = [...this.data.items].sort((a, b) => {
    return b.value - a.value;
  });

  protected readonly total = this.items.reduce((sum, { value }) => {
    return sum + value;
  }, 0);

  private readonly dialogRef =
    inject<
      MatDialogRef<
        GfAllocationDetailDialogComponent,
        AllocationDetailDialogResult
      >
    >(MatDialogRef);

  protected getShareOfCategory({ value }: AllocationDetailItem) {
    return this.total > 0 ? value / this.total : 0;
  }

  protected onClose() {
    this.dialogRef.close();
  }

  protected onHoldingClicked({
    dataSource,
    isClickable,
    symbol
  }: AllocationDetailItem) {
    if (isClickable && dataSource) {
      this.dialogRef.close({ dataSource, symbol });
    }
  }
}
