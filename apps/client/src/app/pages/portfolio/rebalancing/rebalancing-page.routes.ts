import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { GfRebalancingPageComponent } from './rebalancing-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    component: GfRebalancingPageComponent,
    path: '',
    title: internalRoutes.portfolio.subRoutes.rebalancing.title
  }
];
