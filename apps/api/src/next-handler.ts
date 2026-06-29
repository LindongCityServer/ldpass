import 'reflect-metadata';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  RequestMethod,
  ValidationPipe,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import {
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { NestFactory } from '@nestjs/core';
import type { ApiRequestLike, ApiResponseLike } from './shared/auth/request-context.js';
import { AppModule } from './app.module.js';

type ControllerInstance = object;

interface RouteHeader {
  name: string;
  value: string;
}

interface RouteArgumentMetadata {
  index: number;
  data?: string;
}

interface CompiledRoute {
  controllerType: Type<ControllerInstance>;
  methodName: string;
  requestMethod: RequestMethod;
  path: string;
  regex: RegExp;
  paramNames: string[];
  argumentMetadata: Map<RouteParamtypes, RouteArgumentMetadata[]>;
  headers: RouteHeader[];
  httpCode?: number;
  score: number;
}

interface ParsedBody {
  body: unknown;
  rawBody: Buffer;
}

const requestMethodNames = new Map<RequestMethod, string>([
  [RequestMethod.GET, 'GET'],
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.DELETE, 'DELETE'],
  [RequestMethod.PATCH, 'PATCH'],
  [RequestMethod.OPTIONS, 'OPTIONS'],
  [RequestMethod.HEAD, 'HEAD'],
]);

const validationPipe = new ValidationPipe({
  forbidUnknownValues: true,
  transform: true,
  whitelist: true,
});

let applicationContextPromise: Promise<INestApplicationContext> | null = null;
let compiledRoutes: CompiledRoute[] | null = null;

export async function handleNextApiRequest(
  request: Request,
  pathSegments: string[] = [],
): Promise<Response> {
  try {
    const routePath = normalizeRequestPath(pathSegments);
    const route = findRoute(request.method, routePath);

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

    const context = await getApplicationContext();
    const controller = context.get(route.controllerType, { strict: false });
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

async function getApplicationContext(): Promise<INestApplicationContext> {
  applicationContextPromise ??= NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  return applicationContextPromise;
}

function findRoute(method: string, path: string): CompiledRoute | null {
  const requestMethod = method.toUpperCase();
  return (
    getCompiledRoutes().find((route) => {
      const routeMethod = requestMethodNames.get(route.requestMethod);
      return (
        (routeMethod === requestMethod || route.requestMethod === RequestMethod.ALL) &&
        route.regex.test(path)
      );
    }) ?? null
  );
}

function getCompiledRoutes(): CompiledRoute[] {
  if (compiledRoutes) {
    return compiledRoutes;
  }

  compiledRoutes = readControllerTypes(AppModule).flatMap((controllerType) =>
    compileControllerRoutes(controllerType),
  );
  compiledRoutes.sort((left, right) => right.score - left.score);
  return compiledRoutes;
}

function readControllerTypes(
  moduleType: Type<unknown>,
  visitedModules = new Set<Type<unknown>>(),
): Type<ControllerInstance>[] {
  if (visitedModules.has(moduleType)) {
    return [];
  }

  visitedModules.add(moduleType);

  const controllers =
    (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleType) as
      | Type<ControllerInstance>[]
      | undefined) ?? [];
  const importedModules =
    (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[] | undefined) ?? [];

  return [
    ...controllers,
    ...importedModules.flatMap((importedModule) => {
      const importedModuleType = resolveImportedModuleType(importedModule);
      return importedModuleType ? readControllerTypes(importedModuleType, visitedModules) : [];
    }),
  ];
}

function resolveImportedModuleType(importedModule: unknown): Type<unknown> | null {
  if (typeof importedModule === 'function') {
    return importedModule as Type<unknown>;
  }

  if (!importedModule || typeof importedModule !== 'object') {
    return null;
  }

  if (
    'forwardRef' in importedModule &&
    typeof (importedModule as { forwardRef?: unknown }).forwardRef === 'function'
  ) {
    return (importedModule as { forwardRef: () => Type<unknown> }).forwardRef();
  }

  if (
    'module' in importedModule &&
    typeof (importedModule as { module?: unknown }).module === 'function'
  ) {
    return (importedModule as { module: Type<unknown> }).module;
  }

  return null;
}

function compileControllerRoutes(controllerType: Type<ControllerInstance>): CompiledRoute[] {
  const controllerPath = readRoutePaths(Reflect.getMetadata(PATH_METADATA, controllerType));
  const routeDefinitions: CompiledRoute[] = [];

  for (const methodName of Object.getOwnPropertyNames(controllerType.prototype)) {
    if (methodName === 'constructor') {
      continue;
    }

    const method = (controllerType.prototype as Record<string, unknown>)[methodName] as object;
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod | undefined;
    if (requestMethod === undefined) {
      continue;
    }

    const methodPaths = readRoutePaths(Reflect.getMetadata(PATH_METADATA, method));
    for (const basePath of controllerPath) {
      for (const methodPath of methodPaths) {
        const path = joinRoutePath(basePath, methodPath);
        const { regex, paramNames } = compilePathRegex(path);
        routeDefinitions.push({
          controllerType,
          methodName,
          requestMethod,
          path,
          regex,
          paramNames,
          argumentMetadata: readArgumentMetadata(controllerType, methodName),
          headers: Reflect.getMetadata(HEADERS_METADATA, method) ?? [],
          httpCode: Reflect.getMetadata(HTTP_CODE_METADATA, method),
          score: scoreRoute(path),
        });
      }
    }
  }

  return routeDefinitions;
}

function readRoutePaths(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRoutePath(String(item)));
  }

  if (value === undefined || value === null) {
    return [''];
  }

  return [normalizeRoutePath(String(value))];
}

function readArgumentMetadata(
  controllerType: Type<ControllerInstance>,
  methodName: string,
): Map<RouteParamtypes, RouteArgumentMetadata[]> {
  const rawMetadata = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controllerType, methodName) ??
    {}) as Record<string, RouteArgumentMetadata>;
  const result = new Map<RouteParamtypes, RouteArgumentMetadata[]>();

  for (const [key, metadata] of Object.entries(rawMetadata)) {
    const type = Number.parseInt(key.split(':')[0] ?? '', 10) as RouteParamtypes;
    const entries = result.get(type) ?? [];
    entries.push(metadata);
    result.set(type, entries);
  }

  return result;
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
  ) as Type<unknown>[] | undefined;
  const args: unknown[] = [];

  for (const [type, metadataEntries] of route.argumentMetadata) {
    for (const metadata of metadataEntries) {
      const value = await readArgumentValue(type, metadata, input);
      args[metadata.index] = await transformArgumentValue(
        value,
        type,
        metadata,
        paramTypes?.[metadata.index],
      );
    }
  }

  if (typeof method !== 'function') {
    throw new Error(`Route handler ${route.methodName} is not callable.`);
  }

  return args;
}

async function readArgumentValue(
  type: RouteParamtypes,
  metadata: RouteArgumentMetadata,
  input: {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    request: ApiRequestLike;
    response: ApiResponseLike;
  },
): Promise<unknown> {
  switch (type) {
    case RouteParamtypes.REQUEST:
      return input.request;
    case RouteParamtypes.RESPONSE:
      return input.response;
    case RouteParamtypes.BODY:
      return metadata.data ? readObjectField(input.body, metadata.data) : input.body;
    case RouteParamtypes.QUERY:
      return metadata.data ? input.query[metadata.data] : input.query;
    case RouteParamtypes.PARAM:
      return metadata.data ? input.params[metadata.data] : input.params;
    case RouteParamtypes.HEADERS:
      return metadata.data
        ? input.request.headers[metadata.data.toLowerCase()]
        : input.request.headers;
    case RouteParamtypes.RAW_BODY:
      return input.request.rawBody;
    default:
      return undefined;
  }
}

async function transformArgumentValue(
  value: unknown,
  type: RouteParamtypes,
  metadata: RouteArgumentMetadata,
  metatype: Type<unknown> | undefined,
): Promise<unknown> {
  const argumentType = toArgumentType(type);
  if (!argumentType) {
    return value;
  }

  return validationPipe.transform(value, {
    type: argumentType,
    metatype,
    data: metadata.data,
  });
}

function toArgumentType(type: RouteParamtypes): 'body' | 'query' | 'param' | 'custom' | null {
  switch (type) {
    case RouteParamtypes.BODY:
      return 'body';
    case RouteParamtypes.QUERY:
      return 'query';
    case RouteParamtypes.PARAM:
      return 'param';
    default:
      return null;
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

function defaultStatusFor(requestMethod: RequestMethod): number {
  if (requestMethod === RequestMethod.POST) {
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
