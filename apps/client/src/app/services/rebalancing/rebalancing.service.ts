import {
  CalculateRebalancingDto,
  CreateRebalancingGroupDto,
  UpdateRebalancingGroupDto
} from '@ghostfolio/common/dtos';

import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';

import {
  RebalancingDrift,
  RebalancingGroup,
  RebalancingPlan
} from './rebalancing.interfaces';

@Service()
export class RebalancingService {
  private readonly http = inject(HttpClient);

  public calculate({
    data,
    groupId
  }: {
    data: CalculateRebalancingDto;
    groupId: string;
  }) {
    return this.http.post<RebalancingPlan>(
      `/api/v1/rebalancing/groups/${groupId}/calculate`,
      data
    );
  }

  public createGroup(data: CreateRebalancingGroupDto) {
    return this.http.post<RebalancingGroup>('/api/v1/rebalancing/groups', data);
  }

  public deleteGroup(groupId: string) {
    return this.http.delete<void>(`/api/v1/rebalancing/groups/${groupId}`);
  }

  public fetchDrift(groupId: string) {
    return this.http.get<RebalancingDrift>(
      `/api/v1/rebalancing/groups/${groupId}/drift`
    );
  }

  public fetchGroups() {
    return this.http.get<RebalancingGroup[]>('/api/v1/rebalancing/groups');
  }

  public updateGroup({
    data,
    groupId
  }: {
    data: UpdateRebalancingGroupDto;
    groupId: string;
  }) {
    return this.http.put<RebalancingGroup>(
      `/api/v1/rebalancing/groups/${groupId}`,
      data
    );
  }
}
