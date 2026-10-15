import { AppError } from './index';

export function handleApiError(error: unknown): { status: number; body: { success: false; error: { code: string; message: string; details?: unknown } } } {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: (error as any).errors,
        },
      },
    };
  }

  console.error('Unhandled API Error:', error);
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred',
      },
    },
  };
}
