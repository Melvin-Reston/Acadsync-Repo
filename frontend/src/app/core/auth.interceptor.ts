// Adds the right sign-in token to every API request, and signs out when the session has ended.
// Admin and teacher tokens are kept apart: a teacher token never goes to an admin route, and
// an admin token never goes to a teacher route.
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { TeacherAuthService } from './teacher-auth.service';

const SESSION_ENDED_CODES = ['SESSION_EXPIRED', 'NOT_SIGNED_IN'];

// Teacher routes live under /api/teacher/ and /api/teacher-auth/.
function isTeacherRequest(url: string): boolean {
  return url.startsWith(`${environment.apiUrl}/teacher/`) || url.startsWith(`${environment.apiUrl}/teacher-auth/`);
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const adminAuth = inject(AuthService);
  const teacherAuth = inject(TeacherAuthService);
  const isApiRequest = request.url.startsWith(environment.apiUrl);
  const teacherRequest = isTeacherRequest(request.url);
  const token = teacherRequest ? teacherAuth.token : adminAuth.token;

  if (isApiRequest && token) {
    request = request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (isApiRequest && error.status === 401 && SESSION_ENDED_CODES.includes(error.error?.code)) {
        if (teacherRequest) {
          teacherAuth.endSession();
        } else {
          adminAuth.endSession();
        }
      }
      return throwError(() => error);
    }),
  );
};
