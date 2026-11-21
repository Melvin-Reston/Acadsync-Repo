// Schools API.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { Page, School, SchoolForm } from './models';

export interface SchoolFilters {
  search: string;
  category: string;
  school_type: string;
  page: number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class SchoolsService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/schools`;

  list(filters: SchoolFilters): Observable<Page<School>> {
    return this.http.get<Page<School>>(this.api, { params: toParams({ ...filters }) });
  }

  // Every school, for dropdowns.
  options(): Observable<{ items: School[] }> {
    return this.http.get<{ items: School[] }>(`${this.api}/options`);
  }

  create(form: SchoolForm): Observable<{ school: School }> {
    return this.http.post<{ school: School }>(this.api, form);
  }

  update(id: number, form: SchoolForm): Observable<{ school: School }> {
    return this.http.patch<{ school: School }>(`${this.api}/${id}`, form);
  }

  merge(keepId: number, removeId: number): Observable<{ school: School; moved_teachers: number }> {
    return this.http.post<{ school: School; moved_teachers: number }>(`${this.api}/merge`, {
      keep_id: keepId,
      remove_id: removeId,
    });
  }
}
