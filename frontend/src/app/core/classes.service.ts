// The teacher's own classes, subjects, learners and meetings (Batch 2).
// Everything here is scoped to the signed-in teacher on the server.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BulkUploadResult,
  ClassDetail,
  ClassItem,
  ClassLearner,
  Learner,
  Meeting,
  ScheduleResponse,
  Subject,
} from './models';
import { downloadBlob, toParams } from './helpers';

export interface SubjectForm {
  name: string;
  grade_level: number;
  // core 20/50/30, MAPEH and EPP/TLE 20/60/20 under DO 015.
  group?: 'core' | 'mapeh' | 'epp_tle';
}

export interface ClassForm {
  subject_id: number | null;
  new_subject_name: string;
  grade_level: number;
  section_name: string;
  room: string;
  academic_year: string;
}

export interface LearnerForm {
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  birthdate: string; // "2010-05-14" or '' when not given
}

export interface MeetingForm {
  class_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room: string;
  // When true, the same meeting is added Monday to Friday; a day that
  // would conflict is skipped and reported instead of blocking the rest.
  repeat_week?: boolean;
}

export interface MeetingCreateResult {
  meeting?: Meeting; // single-day add
  meetings?: Meeting[]; // whole-week add: the days that were created
  skipped?: { day_of_week: number; day_name: string; reason: string }[];
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ClassesService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // ---------- Subjects ----------

  subjects(): Observable<{ items: Subject[] }> {
    return this.http.get<{ items: Subject[] }>(`${this.api}/subjects`);
  }

  createSubject(form: SubjectForm): Observable<{ subject: Subject }> {
    return this.http.post<{ subject: Subject }>(`${this.api}/subjects`, form);
  }

  updateSubject(id: number, form: SubjectForm): Observable<{ subject: Subject }> {
    return this.http.patch<{ subject: Subject }>(`${this.api}/subjects/${id}`, form);
  }

  deleteSubject(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/subjects/${id}`);
  }

  // ---------- Classes ----------

  classes(filters: {
    search?: string;
    grade?: number | null;
    academic_year?: string;
    page_size?: number;
  }): Observable<{ items: ClassItem[] }> {
    return this.http.get<{ items: ClassItem[] }>(`${this.api}/classes`, {
      params: toParams(filters),
    });
  }

  classDetail(id: number): Observable<{ class: ClassDetail }> {
    return this.http.get<{ class: ClassDetail }>(`${this.api}/classes/${id}`);
  }

  createClass(form: ClassForm): Observable<{ class: ClassItem }> {
    const body: Record<string, unknown> = {
      grade_level: form.grade_level,
      section_name: form.section_name,
      room: form.room,
      academic_year: form.academic_year,
    };
    if (form.subject_id) {
      body['subject_id'] = form.subject_id;
    } else {
      body['new_subject_name'] = form.new_subject_name;
    }
    return this.http.post<{ class: ClassItem }>(`${this.api}/classes`, body);
  }

  updateClass(id: number, form: ClassForm): Observable<{ class: ClassItem }> {
    return this.http.patch<{ class: ClassItem }>(`${this.api}/classes/${id}`, {
      subject_id: form.subject_id,
      section_name: form.section_name,
      room: form.room,
      academic_year: form.academic_year,
    });
  }

  deleteClass(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/classes/${id}`);
  }

  // ---------- Learners ----------

  // The directory is read in full (up to the API's 100-per-page cap) so a
  // 50-student roster is all here — the Learners tab has no paging.
  learners(search = ''): Observable<{ items: Learner[] }> {
    return this.http.get<{ items: Learner[] }>(`${this.api}/learners`, {
      params: toParams({ search, page_size: 100 }),
    });
  }

  createLearner(form: LearnerForm): Observable<{ learner: Learner }> {
    return this.http.post<{ learner: Learner }>(`${this.api}/learners`, form);
  }

  updateLearner(id: number, form: LearnerForm): Observable<{ learner: Learner }> {
    return this.http.patch<{ learner: Learner }>(`${this.api}/learners/${id}`, form);
  }

  deleteLearner(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/learners/${id}`);
  }

  // Downloads the blank CSV for bulk upload: first_name, last_name,
  // learner_id, sex, birthdate (one learner per row).
  downloadLearnerTemplate(): void {
    this.http
      .get(`${this.api}/learners/upload-template`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => downloadBlob(blob, 'learners-template.csv'),
      });
  }

  // Uploads a CSV of learners. The server checks every row and reports
  // which were added, which were skipped as duplicates, and which failed
  // with their reason — nothing is overwritten.
  uploadLearners(file: File): Observable<BulkUploadResult> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<BulkUploadResult>(`${this.api}/learners/upload`, body);
  }

  classLearners(classId: number): Observable<{ items: ClassLearner[] }> {
    return this.http.get<{ items: ClassLearner[] }>(`${this.api}/classes/${classId}/learners`);
  }

  enrolLearner(
    classId: number,
    learnerId: number,
  ): Observable<{ enrolled: boolean; class: ClassItem }> {
    return this.http.post<{ enrolled: boolean; class: ClassItem }>(
      `${this.api}/classes/${classId}/learners`,
      { learner_id: learnerId },
    );
  }

  removeLearner(
    classId: number,
    learnerId: number,
  ): Observable<{ removed: boolean; class: ClassItem }> {
    return this.http.delete<{ removed: boolean; class: ClassItem }>(
      `${this.api}/classes/${classId}/learners/${learnerId}`,
    );
  }

  // ---------- Meetings and schedules ----------

  meetings(filters: { class_id?: number | null; day_of_week?: number | null } = {}): Observable<{
    items: Meeting[];
  }> {
    return this.http.get<{ items: Meeting[] }>(`${this.api}/meetings`, {
      params: toParams(filters),
    });
  }

  createMeeting(form: MeetingForm): Observable<MeetingCreateResult> {
    return this.http.post<MeetingCreateResult>(`${this.api}/meetings`, form);
  }

  updateMeeting(id: number, form: MeetingForm): Observable<{ meeting: Meeting }> {
    return this.http.patch<{ meeting: Meeting }>(`${this.api}/meetings/${id}`, form);
  }

  deleteMeeting(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/meetings/${id}`);
  }

  schedule(weekStart: string, academicYear?: string): Observable<ScheduleResponse> {
    return this.http.get<ScheduleResponse>(`${this.api}/schedules`, {
      params: toParams({ week_start: weekStart, academic_year: academicYear ?? '' }),
    });
  }

  // Downloads the week's timetable as a CSV file.
  exportScheduleCsv(weekStart: string, academicYear?: string): void {
    this.http
      .get(`${this.api}/schedules`, {
        params: toParams({ week_start: weekStart, academic_year: academicYear ?? '', format: 'csv' }),
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => downloadBlob(blob, `timetable-${weekStart}.csv`),
      });
  }
}
