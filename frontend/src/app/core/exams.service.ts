// Paper exam checker (Batch 10): the teacher's paper exams, their
// answer keys, and the checked sheets. No photo ever leaves the
// browser: the checker reads the sheet on the teacher's device, and
// only the reviewed answers are sent here for scoring.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Exam, ExamDetail, ExamQuestion, ExamScanAnswer } from './models';
import { downloadBlob, toParams } from './helpers';

export interface ExamCreateBody {
  class_id: number;
  quarter: number;
  exam_number: number;
  title: string;
  instructions: string;
  question_count: number;
  points_each: number;
}

export interface ExamUpdateBody {
  title?: string;
  instructions?: string;
  question_count?: number;
  points_each?: number;
}

@Injectable({ providedIn: 'root' })
export class ExamsService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  list(filters: {
    class_id?: number | null;
    quarter?: number | null;
    academic_year?: string;
  }): Observable<{ items: Exam[] }> {
    return this.http.get<{ items: Exam[] }>(`${this.api}/exams`, { params: toParams(filters) });
  }

  create(body: ExamCreateBody): Observable<{ exam: Exam }> {
    return this.http.post<{ exam: Exam }>(`${this.api}/exams`, body);
  }

  detail(id: number): Observable<ExamDetail> {
    return this.http.get<ExamDetail>(`${this.api}/exams/${id}`);
  }

  update(id: number, body: ExamUpdateBody): Observable<{ exam: Exam }> {
    return this.http.patch<{ exam: Exam }>(`${this.api}/exams/${id}`, body);
  }

  saveKey(id: number, questions: ExamQuestion[]): Observable<{ exam: Exam; message: string }> {
    return this.http.put<{ exam: Exam; message: string }>(`${this.api}/exams/${id}/key`, { questions });
  }

  remove(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/exams/${id}`);
  }

  saveScan(
    id: number,
    body: { learner_id: number; answers: ExamScanAnswer[]; source: 'photo' | 'manual' }
  ): Observable<{ scan_id: number; score: number; total_points: number; correct_count: number; message: string }> {
    return this.http.post<{ scan_id: number; score: number; total_points: number; correct_count: number; message: string }>(
      `${this.api}/exams/${id}/scans`,
      body
    );
  }

  deleteScan(id: number, scanId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/exams/${id}/scans/${scanId}`);
  }

  downloadResults(id: number, filename: string): void {
    this.http.get(`${this.api}/exams/${id}`, { params: { format: 'csv' }, responseType: 'blob' }).subscribe({
      next: (blob) => downloadBlob(blob, filename),
    });
  }
}
