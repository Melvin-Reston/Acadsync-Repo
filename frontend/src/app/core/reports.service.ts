// Reports API. Each report takes a date range and can be downloaded as CSV.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { IncomeReport, SubscriptionsReport, TeachersPerSchoolReport } from './models';

export type ReportName = 'income' | 'subscriptions' | 'teachers-per-school';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/reports`;

  income(from: string, to: string): Observable<IncomeReport> {
    return this.http.get<IncomeReport>(`${this.api}/income`, { params: toParams({ from, to }) });
  }

  subscriptions(from: string, to: string): Observable<SubscriptionsReport> {
    return this.http.get<SubscriptionsReport>(`${this.api}/subscriptions`, {
      params: toParams({ from, to }),
    });
  }

  teachersPerSchool(from: string, to: string): Observable<TeachersPerSchoolReport> {
    return this.http.get<TeachersPerSchoolReport>(`${this.api}/teachers-per-school`, {
      params: toParams({ from, to }),
    });
  }

  csv(report: ReportName, from: string, to: string): Observable<Blob> {
    return this.http.get(`${this.api}/${report}`, {
      params: toParams({ from, to, format: 'csv' }),
      responseType: 'blob',
    });
  }
}
