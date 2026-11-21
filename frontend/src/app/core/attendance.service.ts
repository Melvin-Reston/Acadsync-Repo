// Attendance: the daily roll sheet and the QR check-in (Batch 3).
// Everything here is scoped to the signed-in teacher on the server.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AttendanceLookup,
  AttendanceMark,
  AttendanceRoll,
  AttendanceStatus,
} from './models';
import { downloadBlob, toParams } from './helpers';

export interface RollMark {
  learner_id: number;
  status: AttendanceStatus;
  method: 'manual' | 'qr';
  time_in?: string; // "07:32", the time the mark was tapped (Manila time)
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // The roll for one class and date: the enrolled learners with their saved marks.
  roll(classId: number, date: string): Observable<AttendanceRoll> {
    return this.http.get<AttendanceRoll>(`${this.api}/attendance`, {
      params: toParams({ class_id: classId, date }),
    });
  }

  // Saves the whole roll for one class and date (re-saving replaces it).
  saveRoll(
    classId: number,
    date: string,
    marks: RollMark[],
  ): Observable<{ message: string; saved: number }> {
    return this.http.post<{ message: string; saved: number }>(`${this.api}/attendance`, {
      class_id: classId,
      date,
      marks,
    });
  }

  // Resolves a scanned code (or a typed student ID) to the learner, so the
  // teacher can confirm the detail card before anything is marked.
  lookup(classId: number, date: string, code: string): Observable<AttendanceLookup> {
    return this.http.get<AttendanceLookup>(`${this.api}/attendance/lookup`, {
      params: toParams({ class_id: classId, date, code }),
    });
  }

  // Confirms a QR check-in: marks the learner Present via QR.
  checkIn(
    classId: number,
    date: string,
    learnerId: number,
  ): Observable<{
    message: string;
    learner: AttendanceLookup['learner'];
    already_checked_in: boolean;
    mark: AttendanceMark;
  }> {
    return this.http.post<{
      message: string;
      learner: AttendanceLookup['learner'];
      already_checked_in: boolean;
      mark: AttendanceMark;
    }>(`${this.api}/attendance/check-in`, { class_id: classId, date, learner_id: learnerId });
  }

  // Downloads the day sheet for one class and date as a CSV file.
  exportCsv(classId: number, date: string, filename: string): void {
    this.http
      .get(`${this.api}/attendance`, {
        params: toParams({ class_id: classId, date, format: 'csv' }),
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => downloadBlob(blob, filename),
      });
  }
}
