import { Context } from "@cordisjs/core"
import { describe, expect, it } from "vitest"
import type { CompositionPlugin, PluginContext } from "@orahako/plugin-sdk"
import { validatePluginConfig } from "@/lib/plugins/config"
import {
  officialAnalyticsEndpoint,
  officialAnnouncementUrl,
  officialMirrorableOrigins,
  officialReleaseBaseUrl,
  officialUpdateMirrors,
} from "../app-config"
import { analyticsRuntimePlugin, ConfiguredAnalyticsService } from "./analytics"
import { announcementRuntimePlugin, ConfiguredAnnouncementService } from "./announcement"
import { updateRuntimePlugin } from "./update"
import { ConfiguredUpdateService } from "./update/service"
import { STORAGE_KEYS } from "./storage/keys"

function start(plugin: CompositionPlugin, config: Record<string, unknown>): Context {
  if (typeof plugin.definition !== "function") {
    throw new Error(`${plugin.manifest.id} does not expose a plugin function`)
  }
  const ctx = new Context()
  plugin.definition(ctx as unknown as PluginContext, config)
  return ctx
}

describe("official runtime service wiring", () => {
  it("publishes analytics under the configured endpoint", () => {
    const ctx = start(analyticsRuntimePlugin, {
      endpoint: "https://analytics.example.test/beacon",
    })
    const service = ctx.get("analytics") as ConfiguredAnalyticsService

    expect(service).toBeInstanceOf(ConfiguredAnalyticsService)
    expect(service.endpoint).toBe("https://analytics.example.test/beacon")
  })

  it("publishes announcements under the configured document and storage key", () => {
    const ctx = start(announcementRuntimePlugin, {
      endpoint: "https://announcements.example.test/feed.json",
      dismissedStorageKey: "test:dismissed",
    })
    const service = ctx.get("announcement") as ConfiguredAnnouncementService

    expect(service).toBeInstanceOf(ConfiguredAnnouncementService)
    expect(service.endpoint).toBe("https://announcements.example.test/feed.json")
  })

  it("publishes updater under a service name that does not collide with Cordis", () => {
    const ctx = start(updateRuntimePlugin, {
      releaseBaseUrl: "https://releases.example.test/latest",
      currentVersion: "0.16.0",
      mirrors: [
        { label: "Direct", value: "" },
        { label: "Mirror", value: "https://mirror.example.test/" },
      ],
    })
    const service = ctx.get("updater") as ConfiguredUpdateService

    expect(service).toBeInstanceOf(ConfiguredUpdateService)
    expect(service.getMirrors()).toEqual([
      { label: "Direct", value: "" },
      { label: "Mirror", value: "https://mirror.example.test/" },
    ])
  })

  it("accepts the official composition configuration for every service", () => {
    expect(() =>
      validatePluginConfig(analyticsRuntimePlugin.manifest, {
        endpoint: officialAnalyticsEndpoint,
      })
    ).not.toThrow()
    expect(() =>
      validatePluginConfig(announcementRuntimePlugin.manifest, {
        endpoint: officialAnnouncementUrl,
        dismissedStorageKey: STORAGE_KEYS.lastDismissedAnnouncementId,
      })
    ).not.toThrow()
    expect(() =>
      validatePluginConfig(updateRuntimePlugin.manifest, {
        releaseBaseUrl: officialReleaseBaseUrl,
        currentVersion: "0.16.0",
        mirrors: officialUpdateMirrors,
        mirrorableOrigins: officialMirrorableOrigins,
        checkCooldownStorageKey: STORAGE_KEYS.lastUpdateCheck,
        otaCleanupStorageKey: STORAGE_KEYS.otaCleanup,
      })
    ).not.toThrow()
  })
})
