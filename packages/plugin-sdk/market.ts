export type PluginPlatform = "web" | "android"

export interface MarketplaceRelease {
  version: string
  apiVersion: number
  minAppVersion?: string
  platforms: PluginPlatform[]
  zipUrl: string
  sha256: string
  size: number
  publishedAt: string
  changelog?: string
}

export interface MarketplacePlugin {
  id: string
  name: string
  summary: string
  author: string
  homepage?: string
  icon?: string
  categories: string[]
  versions: MarketplaceRelease[]
}

export interface MarketplaceIndex {
  schemaVersion: 1
  updatedAt: string
  plugins: MarketplacePlugin[]
}
