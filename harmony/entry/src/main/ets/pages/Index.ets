import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { NativeBridge, LOCAL_ORIGIN } from '../bridge/NativeBridge';
import { localResourcePath } from '../security/ResourcePolicy';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: NativeBridge = new NativeBridge(this.controller);

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.bridge.initialize(context.resourceManager);
    webview.WebviewController.setWebDebuggingAccess(false);
  }

  onBackPress(): boolean {
    this.controller.runJavaScript("window.dispatchEvent(new Event('ysu-native-back'))").catch(() => {});
    return true;
  }

  private resource(input: string): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseHeader([{ headerKey: 'Cache-Control', headerValue: 'no-store' }]);
    response.setResponseEncoding('utf-8');
    try {
      const path = localResourcePath(input, LOCAL_ORIGIN);
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const bytes = context.resourceManager.getRawFileContentSync(path);
      let mime = 'application/octet-stream';
      if (path.endsWith('.html')) mime = 'text/html';
      else if (path.endsWith('.js')) mime = 'text/javascript';
      else if (path.endsWith('.css')) mime = 'text/css';
      else if (path.endsWith('.txt')) mime = 'text/plain';
      else if (path.endsWith('.json') || path.endsWith('.webmanifest')) mime = 'application/json';
      else if (path.endsWith('.png')) mime = 'image/png';
      else if (path.endsWith('.svg')) mime = 'image/svg+xml';
      else if (path.endsWith('.woff2')) mime = 'font/woff2';
      else if (path.endsWith('.ico')) mime = 'image/x-icon';
      response.setResponseMimeType(mime);
      response.setResponseData(bytes.buffer);
      response.setResponseCode(200);
      response.setReasonMessage('OK');
    } catch {
      response.setResponseMimeType('text/plain');
      response.setResponseData('Resource unavailable');
      response.setResponseCode(403);
      response.setReasonMessage('Forbidden');
    }
    return response;
  }

  build() {
    Column() {
      Web({ src: `${LOCAL_ORIGIN}/`, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .onlineImageAccess(true)
        .multiWindowAccess(false)
        .mixedMode(MixedMode.None)
        .javaScriptProxy({ object: this.bridge, name: 'YSUHarmony',
          methodList: ['postMessage'], controller: this.controller })
        .onLoadIntercept((event) => !event?.data.getRequestUrl().startsWith(`${LOCAL_ORIGIN}/`))
        .onInterceptRequest((event) => this.resource(event?.request.getRequestUrl() ?? ''))
        .onConsole(() => true)
        .width('100%')
        .height('100%')
    }.width('100%').height('100%')
  }
}
