// Online quizzes (Batch 9): the teacher's quizzes and questions, and the
// public link a learner opens. The public calls carry no teacher token:
// they live under /api/quiz/, not /api/teacher/.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  PublicQuiz,
  Quiz,
  QuizDetail,
  QuizLookup,
  QuizQuestion,
  QuizQuestionForm,
  QuizSubmitResult,
} from './models';
import { downloadBlob, toParams } from './helpers';

export interface QuizAnswer {
  question_id: number;
  selected_index: number | null;
}

@Injectable({ providedIn: 'root' })
export class QuizzesService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;
  private readonly pub = `${environment.apiUrl}/quiz`;

  list(filters: {
    class_id?: number | null;
    quarter?: number | null;
    status?: string;
    academic_year?: string;
  }): Observable<{ items: Quiz[] }> {
    return this.http.get<{ items: Quiz[] }>(`${this.api}/quizzes`, { params: toParams(filters) });
  }

  create(body: {
    class_id: number;
    quarter: number;
    quiz_number: number;
    title: string;
    instructions: string;
  }): Observable<{ quiz: Quiz }> {
    return this.http.post<{ quiz: Quiz }>(`${this.api}/quizzes`, body);
  }

  detail(id: number): Observable<QuizDetail> {
    return this.http.get<QuizDetail>(`${this.api}/quizzes/${id}`);
  }

  update(
    id: number,
    body: { title?: string; instructions?: string; deadline?: string | null; clear_deadline?: boolean }
  ): Observable<{ quiz: Quiz }> {
    return this.http.patch<{ quiz: Quiz }>(`${this.api}/quizzes/${id}`, body);
  }

  publish(id: number): Observable<{ quiz: Quiz; message: string }> {
    return this.http.post<{ quiz: Quiz; message: string }>(`${this.api}/quizzes/${id}/publish`, {});
  }

  close(id: number): Observable<{ quiz: Quiz; message: string }> {
    return this.http.post<{ quiz: Quiz; message: string }>(`${this.api}/quizzes/${id}/close`, {});
  }

  remove(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/quizzes/${id}`);
  }

  addQuestion(id: number, body: QuizQuestionForm): Observable<{ question: QuizQuestion }> {
    return this.http.post<{ question: QuizQuestion }>(`${this.api}/quizzes/${id}/questions`, body);
  }

  updateQuestion(id: number, questionId: number, body: QuizQuestionForm): Observable<{ question: QuizQuestion }> {
    return this.http.patch<{ question: QuizQuestion }>(`${this.api}/quizzes/${id}/questions/${questionId}`, body);
  }

  deleteQuestion(id: number, questionId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/quizzes/${id}/questions/${questionId}`);
  }

  resetAttempt(id: number, attemptId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/quizzes/${id}/attempts/${attemptId}/reset`, {});
  }

  downloadResults(id: number, filename: string): void {
    this.http.get(`${this.api}/quizzes/${id}`, { params: { format: 'csv' }, responseType: 'blob' }).subscribe({
      next: (blob) => downloadBlob(blob, filename),
    });
  }

  // ---------- The learner's side (no sign-in) ----------

  publicQuiz(code: string): Observable<PublicQuiz> {
    return this.http.get<PublicQuiz>(`${this.pub}/${code}`);
  }

  lookup(code: string, learnerId: string): Observable<QuizLookup> {
    return this.http.get<QuizLookup>(`${this.pub}/${code}/lookup`, { params: { learner_id: learnerId } });
  }

  submit(code: string, learnerId: string, answers: QuizAnswer[]): Observable<QuizSubmitResult> {
    return this.http.post<QuizSubmitResult>(`${this.pub}/${code}/submit`, { learner_id: learnerId, answers });
  }
}
