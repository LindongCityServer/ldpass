export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ApiRouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

type ApiHandler = typeof import('@ldpass/api/next-handler').handleNextApiRequest;

let apiHandlerPromise: Promise<ApiHandler> | null = null;

async function dispatch(request: Request, context: ApiRouteContext): Promise<Response> {
  const params = await context.params;
  const handler = await loadApiHandler();
  return handler(request, params.path ?? []);
}

async function loadApiHandler(): Promise<ApiHandler> {
  apiHandlerPromise ??= loadExternalApiModule().then((module) => module.handleNextApiRequest);
  return apiHandlerPromise;
}

function loadExternalApiModule(): Promise<{
  handleNextApiRequest: ApiHandler;
}> {
  const importExternal = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{
    handleNextApiRequest: ApiHandler;
  }>;

  return importExternal('@ldpass/api/next-handler');
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
export const HEAD = dispatch;
