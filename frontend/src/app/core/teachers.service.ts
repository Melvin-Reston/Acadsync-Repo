// Teachers API.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { Page, Teacher, TeacherForm } from './models';

export interface TeacherFilters {
  search: string;
  school_id: number | null;
  status: string;
  page: number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class TeachersService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teachers`;

  list(filters: TeacherFilters): Observable<Page<Teacher>> {
    return this.http.get<Page<Teacher>>(this.api, { params: toParams({ ...filters }) });
  }

  get(id: number): Observable<{ teacher: Teacher }> {
    return this.http.get<{ teacher: Teacher }>(`${this.api}/${id}`);
  }

  create(form: TeacherForm): Observable<{ teacher: Teacher }> {
    return this.http.post<{ teacher: Teacher }>(this.api, form);
  }

  update(id: number, form: TeacherForm): Observable<{ teacher: Teacher }> {
    return this.http.patch<{ teacher: Teacher }>(`${this.api}/${id}`, form);
  }

  restrict(id: number, reason: string): Observable<{ teacher: Teacher }> {
    return this.http.post<{ teacher: Teacher }>(`${this.api}/${id}/restrict`, { reason });
  }

  unrestrict(id: number): Observable<{ teacher: Teacher }> {
    return this.http.post<{ teacher: Teacher }>(`${this.api}/${id}/unrestrict`, {});
  }

  resetPassword(id: number): Observable<{ temporary_password: string }> {
    return this.http.post<{ temporary_password: string }>(`${this.api}/${id}/reset-password`, {});
  }
}
