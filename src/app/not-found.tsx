'use client';

export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 mb-4">
          404 - Page Not Found
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          The page you're looking for doesn't exist.
        </p>
      </div>
    </div>
  );
}
