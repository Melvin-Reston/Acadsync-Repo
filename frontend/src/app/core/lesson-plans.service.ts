// Lesson plans (Batch 11): the teacher's ILAW plans. The printout is
// rendered by the browser from the detail read, so there is no
// separate print call: detail() carries the school header too.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { LessonPlan, LessonPlanDetail, LessonPlanForm } from './models';
import { toParams } from './helpers';

@Injectable({ providedIn: 'root' })
export class LessonPlansService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  list(filters: {
    class_id?: number | null;
    quarter?: number | null;
    status?: string;
    academic_year?: string;
    search?: string;
  }): Observable<{ items: LessonPlan[] }> {
    return this.http.get<{ items: LessonPlan[] }>(`${this.api}/lesson-plans`, { params: toParams(filters) });
  }

  create(body: Partial<LessonPlanForm>): Observable<{ plan: LessonPlan }> {
    return this.http.post<{ plan: LessonPlan }>(`${this.api}/lesson-plans`, body);
  }

  detail(id: number): Observable<LessonPlanDetail> {
    return this.http.get<LessonPlanDetail>(`${this.api}/lesson-plans/${id}`);
  }

  update(id: number, body: Partial<LessonPlanForm>): Observable<{ plan: LessonPlan }> {
    return this.http.patch<{ plan: LessonPlan }>(`${this.api}/lesson-plans/${id}`, body);
  }

  duplicate(id: number, body: { week_number: number; session_date: string }): Observable<{ plan: LessonPlan }> {
    return this.http.post<{ plan: LessonPlan }>(`${this.api}/lesson-plans/${id}/duplicate`, body);
  }

  remove(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/lesson-plans/${id}`);
  }
}
