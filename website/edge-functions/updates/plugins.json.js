const DEFAULT_INDEX = {
  schemaVersion: 1,
  updatedAt: '2026-11-13T00:00:00Z',
  plugins: [{
    id: 'ysu.theme.arknights',
    name: '明日方舟 × 新粗野主义',
    summary: '罗德岛终端视觉体系：石墨画布、2px 墨边、零圆角、硬偏移阴影、工程网格与青色信号。',
    author: 'heshuoshuo0512 / ysu-client',
    homepage: 'https://github.com/Youwenqwq/ysu-client/pull/21',
    categories: ['theme'],
    versions: [{
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/ysu.theme.arknights/1.0.0.zip',
      sha256: 'b111ca243ce5ae7a78a24861f12250342cd901da842b65924dfbcc8bec5ca484',
      size: 7164,
      publishedAt: '2026-11-13T00:00:00Z',
    }],
  }, {
    id: 'community.perlica-toybox',
    name: 'Perlica 佩黎卡',
    summary: '地图找车、扫码或车辆号解锁、骑行控制、历史记录与账户管理。首个完整外部社区功能插件。',
    author: 'Youwenqwq / ysu-client community',
    homepage: 'https://github.com/Youwenqwq/ysu-client',
    categories: ['toybox', 'transport'],
    versions: [{
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/community.perlica-toybox/1.0.0.zip',
      sha256: 'c3ad76c73d4709a3607d0c2e214f35dec86ca5e56068caebbae4ff9478d0ab56',
      size: 209234,
      publishedAt: '2026-11-13T09:26:20Z',
      changelog: '首次社区插件发布；包含独立凭据、插件翻译和自有移动子导航。',
    }],
  }],
};

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-cache',
};

function json(value) {
  return new Response(JSON.stringify(value), { headers: HEADERS });
}

export function onRequestGet() {
  return json(DEFAULT_INDEX);
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
