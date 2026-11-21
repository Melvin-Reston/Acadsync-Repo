// Announcements API.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { toParams } from './helpers';
import { Announcement, AnnouncementForm, Page } from './models';

export interface AnnouncementFilters {
  search: string;
  status: string;
  audience: string;
  page: number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/announcements`;

  list(filters: AnnouncementFilters): Observable<Page<Announcement>> {
    return this.http.get<Page<Announcement>>(this.api, { params: toParams({ ...filters }) });
  }

  create(form: AnnouncementForm): Observable<{ announcement: Announcement }> {
    return this.http.post<{ announcement: Announcement }>(this.api, form);
  }

  update(id: number, form: AnnouncementForm): Observable<{ announcement: Announcement }> {
    return this.http.patch<{ announcement: Announcement }>(`${this.api}/${id}`, form);
  }

  remove(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
