import { ApiApplicationContext } from './api-container.js';
import { AppModule } from './app.module.js';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  readControllerMetadata,
  readControllerRoutes,
  transformRouteArgument,
  type RouteArgumentKind,
  type RouteArgumentMetadata,
  type RouteHeaderMetadata,
  type RouteHttpMethod,
  type Type,
} from './framework.js';
import type { ApiRequestLike, ApiResponseLike } from './shared/auth/request-context.js';

type ControllerInstance = object;

interface CompiledRoute {
  controllerType: Type<ControllerInstance>;
  methodName: string;
  requestMethod: RouteHttpMethod;
  path: string;
  regex: RegExp;
  paramNames: string[];
  argumentMetadata: RouteArgumentMetadata[];
  headers: RouteHeaderMetadata[];
  httpCode?: number;
  score: number;
}

interface ParsedBody {
  body: unknown;
  rawBody: Buffer;
}

let applicationContextPromise: Promise<ApiApplicationContext> | null = null;
let compiledRoutes: CompiledRoute[] | null = null;

export async function handleNextApiRequest(
  request: Request,
  pathSegments: string[] = [],
): Promise<Response> {
  try {
    const context = await getApplicationContext();
    const routePath = normalizeRequestPath(pathSegments);
    const route = findRoute(request.method, routePath, context);

    if (!route) {
      return createJsonResponse(
        {
          message: `Cannot ${request.method.toUpperCase()} /api/${routePath}`,
          error: 'Not Found',
          statusCode: HttpStatus.NOT_FOUND,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const controller = await context.get(route.controllerType);
    const response = new HeaderCollector();
    const parsedBody = await readRequestBody(request);
    const url = new URL(request.url);
    const requestLike = createRequestLike(request, url, parsedBody.rawBody);
    const params = readParams(route, routePath);
    const query = readQuery(url);

    for (const header of route.headers) {
      response.setHeader(header.name, header.value);
    }

    const args = await buildRouteArguments(route, controller, {
      body: parsedBody.body,
      params,
      query,
      request: requestLike,
      response,
    });
    const result = await (
      (controller as Record<string, unknown>)[route.methodName] as (...args: unknown[]) => unknown
    ).apply(controller, args);
    const status = route.httpCode ?? defaultStatusFor(route.requestMethod);

    return createSuccessResponse(result, status, response.headers);
  } catch (error) {
    return createErrorResponse(error);
  }
}

async function getApplicationContext(): Promise<ApiApplicationContext> {
  applicationContextPromise ??= createApplicationContext();
  return applicationContextPromise;
}

async function createApplicationContext(): Promise<ApiApplicationContext> {
  const context = new ApiApplicationContext(AppModule);
  await context.init();
  return context;
}

function findRoute(
  method: string,
  path: string,
  context: ApiApplicationContext,
): CompiledRoute | null {
  const requestMethod = method.toUpperCase();
  return (
    getCompiledRoutes(context).find((route) => {
      return (
        (route.requestMethod === requestMethod || route.requestMethod === 'ALL') &&
        route.regex.test(path)
      );
    }) ?? null
  );
}

function getCompiledRoutes(context: ApiApplicationContext): CompiledRoute[] {
  if (compiledRoutes) {
    return compiledRoutes;
  }

  compiledRoutes = context
    .readControllerTypes()
    .flatMap((controllerType) =>
      compileControllerRoutes(controllerType as Type<ControllerInstance>),
    );
  compiledRoutes.sort((left, right) => right.score - left.score);
  return compiledRoutes;
}

function compileControllerRoutes(controllerType: Type<ControllerInstance>): CompiledRoute[] {
  const controller = readControllerMetadata(controllerType);
  if (!controller) {
    return [];
  }

  const routeDefinitions: CompiledRoute[] = [];

  for (const route of readControllerRoutes(controllerType)) {
    for (const basePath of controller.paths) {
      for (const methodPath of route.paths) {
        const path = joinRoutePath(basePath, methodPath);
        const { regex, paramNames } = compilePathRegex(path);
        routeDefinitions.push({
          controllerType,
          methodName: route.methodName,
          requestMethod: route.requestMethod,
          path,
          regex,
          paramNames,
          argumentMetadata: [...route.arguments].sort((left, right) => left.index - right.index),
          headers: route.headers,
          ...(route.httpCode !== undefined ? { httpCode: route.httpCode } : {}),
          score: scoreRoute(path),
        });
      }
    }
  }

  return routeDefinitions;
}

async function buildRouteArguments(
  route: CompiledRoute,
  controller: ControllerInstance,
  input: {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    request: ApiRequestLike;
    response: ApiResponseLike;
  },
): Promise<unknown[]> {
  const method = (controller as Record<string, unknown>)[route.methodName];
  const paramTypes = Reflect.getMetadata(
    'design:paramtypes',
    controller.constructor.prototype,
    route.methodName,
  ) as Type[] | undefined;
  const args: unknown[] = [];

  for (const metadata of route.argumentMetadata) {
    const value = readArgumentValue(metadata.kind, metadata, input);
    args[metadata.index] = await transformRouteArgument(
      value,
      metadata.kind,
      paramTypes?.[metadata.index],
    );
  }

  if (typeof method !== 'function') {
    throw new Error(`Route handler ${route.methodName} is not callable.`);
  }

  return args;
}

function readArgumentValue(
  kind: RouteArgumentKind,
  metadata: RouteArgumentMetadata,
  input: {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    request: ApiRequestLike;
    response: ApiResponseLike;
  },
): unknown {
  switch (kind) {
    case 'request':
      return input.request;
    case 'response':
      return input.response;
    case 'body':
      return metadata.data ? readObjectField(input.body, metadata.data) : input.body;
    case 'query':
      return metadata.data ? input.query[metadata.data] : input.query;
    case 'param':
      return metadata.data ? input.params[metadata.data] : input.params;
    case 'headers':
      return metadata.data
        ? input.request.headers[metadata.data.toLowerCase()]
        : input.request.headers;
    case 'rawBody':
      return input.request.rawBody;
    default:
      return undefined;
  }
}

function createRequestLike(request: Request, url: URL, rawBody: Buffer): ApiRequestLike {
  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const requestLike: ApiRequestLike = {
    headers,
    method: request.method,
    originalUrl: `${url.pathname}${url.search}`,
    url: `${url.pathname}${url.search}`,
    rawBody,
  };
  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const remoteAddress = request.headers.get('x-real-ip');

  if (forwardedIp) {
    requestLike.ip = forwardedIp;
  }

  if (remoteAddress) {
    requestLike.socket = {
      remoteAddress,
    };
  }

  return requestLike;
}

async function readRequestBody(request: Request): Promise<ParsedBody> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {
      body: undefined,
      rawBody: Buffer.alloc(0),
    };
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length === 0) {
    return {
      body: undefined,
      rawBody,
    };
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return {
        body: JSON.parse(rawBody.toString('utf8')) as unknown,
        rawBody,
      };
    } catch {
      throw new BadRequestException('JSON 请求体格式不正确。');
    }
  }

  return {
    body: rawBody.toString('utf8'),
    rawBody,
  };
}

function readParams(route: CompiledRoute, path: string): Record<string, string> {
  const match = route.regex.exec(path);
  if (!match?.groups) {
    return {};
  }

  return Object.fromEntries(route.paramNames.map((name) => [name, match.groups?.[name] ?? '']));
}

function readQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams) {
    const current = query[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (current !== undefined) {
      query[key] = [current, value];
    } else {
      query[key] = value;
    }
  }

  return query;
}

function compilePathRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const segments = normalizeRoutePath(path)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        const paramName = segment.slice(1);
        paramNames.push(paramName);
        return `(?<${paramName}>[^/]+)`;
      }

      return escapeRegExp(segment);
    });

  return {
    regex: new RegExp(`^${segments.join('/')}$`),
    paramNames,
  };
}

function normalizeRequestPath(pathSegments: string[]): string {
  return pathSegments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function normalizeRoutePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function joinRoutePath(...parts: string[]): string {
  return parts.map(normalizeRoutePath).filter(Boolean).join('/');
}

function scoreRoute(path: string): number {
  const segments = normalizeRoutePath(path).split('/').filter(Boolean);
  const staticCount = segments.filter((segment) => !segment.startsWith(':')).length;
  return staticCount * 100 + segments.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readObjectField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function defaultStatusFor(requestMethod: RouteHttpMethod): number {
  if (requestMethod === 'POST') {
    return HttpStatus.CREATED;
  }

  return HttpStatus.OK;
}

function createSuccessResponse(result: unknown, status: number, headers: Headers): Response {
  if (result === undefined || result === null) {
    return new Response(null, {
      status,
      headers,
    });
  }

  if (result instanceof Response) {
    return result;
  }

  if (typeof result === 'string' || result instanceof Uint8Array) {
    if (!headers.has('Content-Type') && typeof result === 'string') {
      headers.set('Content-Type', 'text/plain; charset=utf-8');
    }

    const body = result instanceof Uint8Array ? (result.slice().buffer as ArrayBuffer) : result;

    return new Response(body, {
      status,
      headers,
    });
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(result, jsonReplacer), {
    status,
    headers,
  });
}

function createErrorResponse(error: unknown): Response {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();

    if (typeof response === 'string') {
      return createJsonResponse(
        {
          message: response,
          error: error.name,
          statusCode: status,
        },
        status,
      );
    }

    return createJsonResponse(response, status);
  }

  return createJsonResponse(
    {
      message: 'Internal server error',
      error: 'Internal Server Error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function createJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload, jsonReplacer), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

class HeaderCollector implements ApiResponseLike {
  readonly headers = new Headers();

  setHeader(name: string, value: string | string[]): void {
    if (Array.isArray(value)) {
      this.headers.delete(name);
      for (const item of value) {
        this.headers.append(name, item);
      }
      return;
    }

    if (name.toLowerCase() === 'set-cookie') {
      this.headers.append(name, value);
      return;
    }

    this.headers.set(name, value);
  }
}
