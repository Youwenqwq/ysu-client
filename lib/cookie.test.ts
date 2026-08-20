import { describe, expect, it } from 'vitest';
import { SimpleCookieJar } from '@/lib/cookie';

describe('SimpleCookieJar cookie matching', () => {
  it('发送 Path 以 / 结尾的 cookie 到嵌套路径（RFC 6265 前缀匹配）', async () => {
    const jar = new SimpleCookieJar();
    // jwxt.ysu.edu.cn 的 GS_SESSIONID 就是 Path=/jwapp/
    await jar.setCookie(
      'GS_SESSIONID=abc123; path=/jwapp/; HttpOnly',
      'https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do',
    );
    const header = await jar.getCookieString(
      'https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do',
    );
    expect(header).toContain('GS_SESSIONID=abc123');
  });

  it('Path=/ 的 cookie 按 RFC 默认匹配所有路径', async () => {
    const jar = new SimpleCookieJar();
    await jar.setCookie('rootonly=1; Path=/', 'https://jwxt.ysu.edu.cn/');
    const header = await jar.getCookieString(
      'https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do',
    );
    expect(header).toContain('rootonly=1');
  });
});

describe('SimpleCookieJar deletion & empty-value cookies', () => {
  it('Max-Age=0 的清除 cookie 不进入 jar，也不随请求发出', async () => {
    const jar = new SimpleCookieJar();
    await jar.setCookie(
      'CASTGC=; Max-Age=0; Path=/authserver/; HttpOnly',
      'https://cer.ysu.edu.cn/authserver/login',
    );
    const header = await jar.getCookieString(
      'https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do',
    );
    expect(header).not.toContain('CASTGC');
  });

  it('清除 cookie（不同 path）不会删掉同名的真实 cookie，且真实值胜出去重', async () => {
    const jar = new SimpleCookieJar();
    await jar.setCookie(
      'CASTGC=real-tgc; Path=/authserver; HttpOnly',
      'https://cer.ysu.edu.cn/authserver/login',
    );
    // 服务器随后下发的清除 cookie 路径更长（/authserver/）
    await jar.setCookie(
      'CASTGC=; Max-Age=0; Path=/authserver/; HttpOnly',
      'https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do',
    );
    const header = await jar.getCookieString(
      'https://cer.ysu.edu.cn/authserver/dynamicCode/getDynamicCodeByReauth.do',
    );
    expect(header).toContain('CASTGC=real-tgc');
    expect(header).not.toMatch(/CASTGC=(;|$)/);
  });

  it('同 path 的 Max-Age=0 删除既有条目', async () => {
    const jar = new SimpleCookieJar();
    await jar.setCookie(
      'route=abc; Path=/authserver',
      'https://cer.ysu.edu.cn/authserver/login',
    );
    await jar.setCookie(
      'route=; Max-Age=0; Path=/authserver',
      'https://cer.ysu.edu.cn/authserver/login',
    );
    const header = await jar.getCookieString(
      'https://cer.ysu.edu.cn/authserver/login',
    );
    expect(header).not.toContain('route');
  });
});
