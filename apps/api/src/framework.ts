import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export type Type<T = unknown> = new (...args: any[]) => T;
export type InjectionToken<T = unknown> = Type<T> | string | symbol;

export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

export interface ClassProvider<T = unknown> {
  provide: InjectionToken<T>;
  useClass: Type<T>;
}

export interface ValueProvider<T = unknown> {
  provide: InjectionToken<T>;
  useValue: T;
}

export interface FactoryProvider<T = unknown> {
  provide: InjectionToken<T>;
  useFactory: (...args: unknown[]) => T | Promise<T>;
  inject?: InjectionToken[];
}

export type Provider<T = unknown> =
  | Type<T>
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>;

export interface ModuleMetadata {
  imports?: unknown[];
  controllers?: Type[];
  providers?: Provider[];
  exports?: InjectionToken[];
}

export type RouteHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'HEAD'
  | 'ALL';

export type RouteArgumentKind =
  | 'body'
  | 'query'
  | 'param'
  | 'request'
  | 'response'
  | 'headers'
  | 'rawBody';

export interface RouteArgumentMetadata {
  index: number;
  kind: RouteArgumentKind;
  data?: string;
}

export interface RouteHeaderMetadata {
  name: string;
  value: string;
}

export interface ControllerMetadata {
  paths: string[];
}

export interface RouteMetadata {
  methodName: string;
  requestMethod: RouteHttpMethod;
  paths: string[];
  arguments: RouteArgumentMetadata[];
  headers: RouteHeaderMetadata[];
  httpCode?: number;
}

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

const controllerMetadata = new WeakMap<Function, ControllerMetadata>();
const routeMetadata = new WeakMap<object, Map<string | symbol, RouteMetadata>>();
const moduleMetadata = new WeakMap<Function, ModuleMetadata>();
const injectionMetadata = new WeakMap<Function, Map<number, InjectionToken>>();
const globalModules = new WeakSet<Function>();
const validationPassthroughTypes: Function[] = [String, Boolean, Number, Array, Object];

export class HttpException extends Error {
  constructor(
    private readonly response: string | Record<string, unknown>,
    private readonly status: number,
  ) {
    super(typeof response === 'string' ? response : readResponseMessage(response));
    this.name = new.target.name;
  }

  getStatus(): number {
    return this.status;
  }

  getResponse(): string | Record<string, unknown> {
    return this.response;
  }
}

export class BadRequestException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Bad Request') {
    super(
      createExceptionResponse(response, 'Bad Request', HttpStatus.BAD_REQUEST),
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class UnauthorizedException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Unauthorized') {
    super(
      createExceptionResponse(response, 'Unauthorized', HttpStatus.UNAUTHORIZED),
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ForbiddenException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Forbidden') {
    super(
      createExceptionResponse(response, 'Forbidden', HttpStatus.FORBIDDEN),
      HttpStatus.FORBIDDEN,
    );
  }
}

export class NotFoundException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Not Found') {
    super(
      createExceptionResponse(response, 'Not Found', HttpStatus.NOT_FOUND),
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Conflict') {
    super(createExceptionResponse(response, 'Conflict', HttpStatus.CONFLICT), HttpStatus.CONFLICT);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Internal Server Error') {
    super(
      createExceptionResponse(response, 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(response: string | Record<string, unknown> = 'Service Unavailable') {
    super(
      createExceptionResponse(response, 'Service Unavailable', HttpStatus.SERVICE_UNAVAILABLE),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class Logger {
  constructor(private readonly context?: string) {}

  log(message: unknown): void {
    console.log(this.format(message));
  }

  warn(message: unknown): void {
    console.warn(this.format(message));
  }

  error(message: unknown): void {
    console.error(this.format(message));
  }

  private format(message: unknown): string {
    const text = message instanceof Error ? message.message : String(message);
    return this.context ? `[${this.context}] ${text}` : text;
  }
}

export function Injectable(): ClassDecorator {
  return () => undefined;
}

export function Inject(token: InjectionToken): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey !== undefined || typeof target !== 'function') {
      return;
    }

    const metadata = injectionMetadata.get(target) ?? new Map<number, InjectionToken>();
    metadata.set(parameterIndex, token);
    injectionMetadata.set(target, metadata);
  };
}

export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target) => {
    moduleMetadata.set(target, metadata);
  };
}

export function Global(): ClassDecorator {
  return (target) => {
    globalModules.add(target);
  };
}

export function Controller(path?: string | string[]): ClassDecorator {
  return (target) => {
    controllerMetadata.set(target, {
      paths: readPaths(path),
    });
  };
}

export function Get(path?: string | string[]): MethodDecorator {
  return routeMethod('GET', path);
}

export function Post(path?: string | string[]): MethodDecorator {
  return routeMethod('POST', path);
}

export function Put(path?: string | string[]): MethodDecorator {
  return routeMethod('PUT', path);
}

export function Patch(path?: string | string[]): MethodDecorator {
  return routeMethod('PATCH', path);
}

export function Delete(path?: string | string[]): MethodDecorator {
  return routeMethod('DELETE', path);
}

export function Options(path?: string | string[]): MethodDecorator {
  return routeMethod('OPTIONS', path);
}

export function Head(path?: string | string[]): MethodDecorator {
  return routeMethod('HEAD', path);
}

export function All(path?: string | string[]): MethodDecorator {
  return routeMethod('ALL', path);
}

export function Body(data?: string): ParameterDecorator {
  return routeArgument('body', data);
}

export function Query(data?: string): ParameterDecorator {
  return routeArgument('query', data);
}

export function Param(data?: string): ParameterDecorator {
  return routeArgument('param', data);
}

export function Req(): ParameterDecorator {
  return routeArgument('request');
}

export function Res(_options?: { passthrough?: boolean }): ParameterDecorator {
  return routeArgument('response');
}

export function Headers(data?: string): ParameterDecorator {
  return routeArgument('headers', data);
}

export function RawBody(): ParameterDecorator {
  return routeArgument('rawBody');
}

export function Header(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => {
    const route = ensureRouteMetadata(target, propertyKey);
    route.headers.push({ name, value });
  };
}

export function HttpCode(statusCode: number): MethodDecorator {
  return (target, propertyKey) => {
    const route = ensureRouteMetadata(target, propertyKey);
    route.httpCode = statusCode;
  };
}

export function readControllerMetadata(controllerType: Type): ControllerMetadata | null {
  return controllerMetadata.get(controllerType) ?? null;
}

export function readControllerRoutes(controllerType: Type): RouteMetadata[] {
  const routes = routeMetadata.get(controllerType.prototype);
  return routes ? [...routes.values()] : [];
}

export function readModuleMetadata(moduleType: Type): ModuleMetadata {
  return moduleMetadata.get(moduleType) ?? {};
}

export function readInjectedTokens(target: Type): Map<number, InjectionToken> {
  return new Map(injectionMetadata.get(target) ?? []);
}

export function isGlobalModule(moduleType: Type): boolean {
  return globalModules.has(moduleType);
}

export async function transformRouteArgument(
  value: unknown,
  kind: RouteArgumentKind,
  metatype: Type | undefined,
): Promise<unknown> {
  if (!metatype || !shouldValidate(metatype)) {
    return value;
  }

  if (kind !== 'body' && kind !== 'query' && kind !== 'param') {
    return value;
  }

  const objectValue = value === undefined || value === null ? {} : value;
  const instance = plainToInstance(metatype, objectValue, {
    enableImplicitConversion: true,
  });
  const errors = await validate(instance as object, {
    forbidUnknownValues: true,
    whitelist: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException({
      message: errors.flatMap((error) => Object.values(error.constraints ?? {})),
      error: 'Bad Request',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }

  return instance;
}

function routeMethod(requestMethod: RouteHttpMethod, path?: string | string[]): MethodDecorator {
  return (target, propertyKey) => {
    const route = ensureRouteMetadata(target, propertyKey);
    route.requestMethod = requestMethod;
    route.paths = readPaths(path);
  };
}

function routeArgument(kind: RouteArgumentKind, data?: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      return;
    }

    const route = ensureRouteMetadata(target, propertyKey);
    const existingIndex = route.arguments.findIndex((entry) => entry.index === parameterIndex);
    const metadata: RouteArgumentMetadata = {
      index: parameterIndex,
      kind,
      ...(data !== undefined ? { data } : {}),
    };

    if (existingIndex >= 0) {
      route.arguments[existingIndex] = metadata;
      return;
    }

    route.arguments.push(metadata);
  };
}

function ensureRouteMetadata(target: object, propertyKey: string | symbol): RouteMetadata {
  const routes = routeMetadata.get(target) ?? new Map<string | symbol, RouteMetadata>();
  const existing = routes.get(propertyKey);
  if (existing) {
    return existing;
  }

  const route: RouteMetadata = {
    methodName: String(propertyKey),
    requestMethod: 'GET',
    paths: [''],
    arguments: [],
    headers: [],
  };
  routes.set(propertyKey, route);
  routeMetadata.set(target, routes);
  return route;
}

function readPaths(path?: string | string[]): string[] {
  if (Array.isArray(path)) {
    return path.map((item) => normalizeRoutePath(item));
  }

  if (path === undefined) {
    return [''];
  }

  return [normalizeRoutePath(path)];
}

function normalizeRoutePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function shouldValidate(metatype: Type): boolean {
  return !validationPassthroughTypes.includes(metatype);
}

function createExceptionResponse(
  response: string | Record<string, unknown>,
  error: string,
  statusCode: number,
): Record<string, unknown> {
  if (typeof response !== 'string') {
    return response;
  }

  return {
    message: response,
    error,
    statusCode,
  };
}

function readResponseMessage(response: Record<string, unknown>): string {
  const message = response.message;
  if (Array.isArray(message)) {
    return message.join(', ');
  }

  return typeof message === 'string' ? message : 'HTTP exception';
}
