// Route guards: who may open which teacher page.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { TeacherAuthService } from './teacher-auth.service';

// Teacher pages: only for a signed-in teacher.
export const teacherGuard: CanActivateFn = () => {
  const auth = inject(TeacherAuthService);
  const router = inject(Router);

  if (!auth.token) {
    return router.createUrlTree(['/teacher/login']);
  }
  if (auth.teacher()) {
    return true;
  }

  // A token is saved but the page was refreshed: check it with the API.
  return auth.loadCurrentTeacher().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/teacher/login']))),
  );
};

// Teacher sign-in pages: someone who is already signed in goes straight to the dashboard.
export const teacherGuestGuard: CanActivateFn = () => {
  const auth = inject(TeacherAuthService);
  const router = inject(Router);
  return auth.token ? router.createUrlTree(['/teacher/dashboard']) : true;
};
