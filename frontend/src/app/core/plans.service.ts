// Plans & Packages API.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Plan, PlanForm } from './models';

@Injectable({ providedIn: 'root' })
export class PlansService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/plans`;

  // Every plan, active or not.
  list(): Observable<{ items: Plan[] }> {
    return this.http.get<{ items: Plan[] }>(this.api);
  }

  create(form: PlanForm): Observable<{ plan: Plan }> {
    return this.http.post<{ plan: Plan }>(this.api, form);
  }

  update(id: number, form: PlanForm): Observable<{ plan: Plan }> {
    return this.http.patch<{ plan: Plan }>(`${this.api}/${id}`, form);
  }

  setActive(id: number, active: boolean): Observable<{ plan: Plan }> {
    return this.http.post<{ plan: Plan }>(
      `${this.api}/${id}/${active ? 'activate' : 'deactivate'}`,
      {},
    );
  }

  remove(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
