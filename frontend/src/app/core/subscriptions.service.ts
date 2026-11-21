// Subscriptions API. A subscription always belongs to one teacher.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { Subscription, SubscriptionInvoice, SubscriptionPage } from './models';

export interface SubscriptionFilters {
  search: string;
  plan_id: number | null;
  status: string;
  page: number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/subscriptions`;

  list(filters: SubscriptionFilters): Observable<SubscriptionPage> {
    return this.http.get<SubscriptionPage>(this.api, { params: toParams({ ...filters }) });
  }

  get(id: number): Observable<{ subscription: Subscription; invoices: SubscriptionInvoice[] }> {
    return this.http.get<{ subscription: Subscription; invoices: SubscriptionInvoice[] }>(
      `${this.api}/${id}`,
    );
  }

  create(teacherId: number, planId: number, withTrial: boolean): Observable<{ subscription: Subscription }> {
    return this.http.post<{ subscription: Subscription }>(this.api, {
      teacher_id: teacherId,
      plan_id: planId,
      with_trial: withTrial,
    });
  }

  extend(id: number, months: number): Observable<{ subscription: Subscription }> {
    return this.http.post<{ subscription: Subscription }>(`${this.api}/${id}/extend`, { months });
  }

  cancel(id: number, reason: string): Observable<{ subscription: Subscription }> {
    return this.http.post<{ subscription: Subscription }>(`${this.api}/${id}/cancel`, { reason });
  }

  changePlan(id: number, planId: number, withTrial: boolean): Observable<{ subscription: Subscription }> {
    return this.http.post<{ subscription: Subscription }>(`${this.api}/${id}/change-plan`, {
      plan_id: planId,
      with_trial: withTrial,
    });
  }
}
