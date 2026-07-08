import {
  readInjectedTokens,
  readModuleMetadata,
  type FactoryProvider,
  type InjectionToken,
  type OnModuleInit,
  type Provider,
  type Type,
  type ValueProvider,
} from './framework.js';

export class ApiApplicationContext {
  private readonly providerDefinitions = new Map<InjectionToken, Provider>();
  private readonly providerOrder: InjectionToken[] = [];
  private readonly controllerTypes: Type[] = [];
  private readonly instances = new Map<InjectionToken, unknown>();
  private initialized = false;

  constructor(rootModule: Type) {
    this.collectModule(rootModule, new Set<Type>());
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    for (const token of this.providerOrder) {
      await this.get(token);
    }

    for (const controllerType of this.controllerTypes) {
      await this.get(controllerType);
    }

    for (const instance of this.instances.values()) {
      if (isModuleInit(instance)) {
        await instance.onModuleInit();
      }
    }

    this.initialized = true;
  }

  async get<T>(token: InjectionToken<T>): Promise<T> {
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const definition = this.providerDefinitions.get(token) ?? (isType(token) ? token : null);
    if (!definition) {
      throw new Error(`API provider is not registered: ${String(token)}`);
    }

    const instance = await this.instantiateProvider(definition);
    this.instances.set(token, instance);
    return instance as T;
  }

  readControllerTypes(): Type[] {
    return [...this.controllerTypes];
  }

  private collectModule(moduleType: Type, visitedModules: Set<Type>): void {
    if (visitedModules.has(moduleType)) {
      return;
    }

    visitedModules.add(moduleType);
    const metadata = readModuleMetadata(moduleType);

    for (const importedModule of metadata.imports ?? []) {
      const importedModuleType = resolveImportedModuleType(importedModule);
      if (importedModuleType) {
        this.collectModule(importedModuleType, visitedModules);
      }
    }

    for (const provider of metadata.providers ?? []) {
      const token = readProviderToken(provider);
      if (!this.providerDefinitions.has(token)) {
        this.providerOrder.push(token);
      }
      this.providerDefinitions.set(token, provider);
    }

    for (const controllerType of metadata.controllers ?? []) {
      if (!this.providerDefinitions.has(controllerType)) {
        this.providerOrder.push(controllerType);
      }
      this.providerDefinitions.set(controllerType, controllerType);
      if (!this.controllerTypes.includes(controllerType)) {
        this.controllerTypes.push(controllerType);
      }
    }
  }

  private async instantiateProvider(provider: Provider): Promise<unknown> {
    if (isValueProvider(provider)) {
      return provider.useValue;
    }

    if (isFactoryProvider(provider)) {
      const args = await Promise.all((provider.inject ?? []).map((token) => this.get(token)));
      return provider.useFactory(...args);
    }

    const providerType = isClassProvider(provider) ? provider.useClass : provider;
    return this.instantiateClass(providerType);
  }

  private async instantiateClass<T>(providerType: Type<T>): Promise<T> {
    const paramTypes =
      (Reflect.getMetadata('design:paramtypes', providerType) as Type[] | undefined) ?? [];
    const injectedTokens = readInjectedTokens(providerType);
    const args = await Promise.all(
      paramTypes.map((paramType, index) => this.get(injectedTokens.get(index) ?? paramType)),
    );

    return new providerType(...args);
  }
}

function readProviderToken(provider: Provider): InjectionToken {
  if (isType(provider)) {
    return provider;
  }

  return provider.provide;
}

function isType(value: unknown): value is Type {
  return typeof value === 'function';
}

function isClassProvider(
  provider: Provider,
): provider is { provide: InjectionToken; useClass: Type } {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function isValueProvider(provider: Provider): provider is ValueProvider {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function isFactoryProvider(provider: Provider): provider is FactoryProvider {
  return typeof provider === 'object' && provider !== null && 'useFactory' in provider;
}

function isModuleInit(instance: unknown): instance is OnModuleInit {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'onModuleInit' in instance &&
    typeof (instance as OnModuleInit).onModuleInit === 'function'
  );
}

function resolveImportedModuleType(importedModule: unknown): Type | null {
  if (typeof importedModule === 'function') {
    return importedModule as Type;
  }

  if (!importedModule || typeof importedModule !== 'object') {
    return null;
  }

  if (
    'forwardRef' in importedModule &&
    typeof (importedModule as { forwardRef?: unknown }).forwardRef === 'function'
  ) {
    return (importedModule as { forwardRef: () => Type }).forwardRef();
  }

  if (
    'module' in importedModule &&
    typeof (importedModule as { module?: unknown }).module === 'function'
  ) {
    return (importedModule as { module: Type }).module;
  }

  return null;
}
