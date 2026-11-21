// Teacher sign-in and sign-up, and remembering which teacher is signed in.
// Kept separate from the admin AuthService: the two sides never share a token.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TeacherSelf, TeacherSession } from './models';

const TOKEN_KEY = 'acadsync_teacher_token';

export interface TeacherRegisterBody {
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  present_address: string;
  school_id: number;
  password: string;
  terms_accepted: boolean;
}

@Injectable({ providedIn: 'root' })
export class TeacherAuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = `${environment.apiUrl}/teacher-auth`;
  private readonly portalApi = `${environment.apiUrl}/teacher`;

  private readonly currentTeacher = signal<TeacherSelf | null>(null);

  readonly teacher = this.currentTeacher.asReadonly();

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  // Creates the account and signs the teacher in straight away.
  register(body: TeacherRegisterBody): Observable<TeacherSession> {
    return this.http
      .post<TeacherSession>(`${this.api}/register`, body)
      .pipe(tap((session) => this.startSession(session)));
  }

  login(login: string, password: string, rememberMe = false): Observable<TeacherSession> {
    return this.http
      .post<TeacherSession>(`${this.api}/login`, { login, password, remember_me: rememberMe })
      .pipe(tap((session) => this.startSession(session)));
  }

  // Asks the API who the saved token belongs to (used after a page refresh).
  loadCurrentTeacher(): Observable<{ teacher: TeacherSelf }> {
    return this.http
      .get<{ teacher: TeacherSelf }>(`${this.portalApi}/me`)
      .pipe(tap((response) => this.currentTeacher.set(response.teacher)));
  }

  changePassword(currentPassword: string, newPassword: string): Observable<TeacherSession> {
    return this.http
      .post<TeacherSession>(`${this.portalApi}/change-password`, {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .pipe(
        tap((session) => this.startSession(session)),
        // The password change does not navigate, so reload the full profile here:
        // otherwise the layout's teacher card and Sign out button would disappear
        // (startSession clears the saved teacher until the guard reloads it).
        switchMap((session) => this.loadCurrentTeacher().pipe(map(() => session))),
      );
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/forgot-password`, { email });
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/reset-password`, {
      token,
      new_password: newPassword,
    });
  }

  logout(): void {
    this.endSession();
  }

  // Keeps the layout's teacher card in step when a page already has the fresh
  // teacher record (profile save, adviser save) instead of reloading it.
  setTeacher(teacher: TeacherSelf): void {
    this.currentTeacher.set(teacher);
  }

  // Clears the saved session and returns to the teacher sign-in page.
  endSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.currentTeacher.set(null);
    this.router.navigate(['/teacher/login']);
  }

  private startSession(session: TeacherSession): void {
    localStorage.setItem(TOKEN_KEY, session.token);
    // The full profile is loaded by the route guard, so the layout always shows real data.
    this.currentTeacher.set(null);
  }
}
