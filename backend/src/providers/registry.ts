import type { ProviderCapability, ProviderInfo } from "./provider.interface.js"

interface RegisteredProvider {
  info: ProviderInfo
  instance: unknown // The actual provider object implementing capability interfaces
}

class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>()

  // Register a provider
  register(info: ProviderInfo, instance: unknown): void {
    this.providers.set(info.id, { info, instance })
    console.log(
      `[ProviderRegistry] Registered: ${info.name} (${info.capabilities.join(", ")})`
    )
  }

  // Get a specific provider by id
  getProvider(providerId: string): unknown | null {
    return this.providers.get(providerId)?.instance ?? null
  }

  // Get provider info
  getProviderInfo(providerId: string): ProviderInfo | null {
    return this.providers.get(providerId)?.info ?? null
  }

  // Find all providers that support a capability
  getProvidersForCapability(
    capability: ProviderCapability
  ): Array<{ id: string; instance: unknown }> {
    const result: Array<{ id: string; instance: unknown }> = []
    for (const [id, provider] of this.providers) {
      if (provider.info.capabilities.includes(capability)) {
        result.push({ id, instance: provider.instance })
      }
    }
    return result
  }

  // Check if a specific provider supports a specific model for a capability
  supportsModel(
    providerId: string,
    capability: ProviderCapability,
    model: string
  ): boolean {
    const provider = this.providers.get(providerId)
    if (!provider) return false
    const models = provider.info.supportedModels[capability]
    return models?.includes(model) ?? false
  }

  // List all registered providers
  listProviders(): ProviderInfo[] {
    return Array.from(this.providers.values()).map((p) => p.info)
  }
}

// Singleton
export const providerRegistry = new ProviderRegistry()
