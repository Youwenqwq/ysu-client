export interface MfaRequest {
  readonly username: string
  readonly method?: string
}

export type MfaResult =
  | { type: "code"; method: string; methodCode: string; code: string }
  | { type: "wechat" }

export interface PluginMfaService {
  show(request: MfaRequest): Promise<MfaResult>
}
