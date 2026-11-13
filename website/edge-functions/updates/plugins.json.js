const DEFAULT_INDEX = {
  schemaVersion: 1,
  updatedAt: '2026-11-13T10:04:29Z',
  plugins: [{
    id: 'ysu.theme.arknights',
    name: '明日方舟 × 新粗野主义',
    summary: '罗德岛终端视觉体系：石墨画布、2px 墨边、零圆角、硬偏移阴影、工程网格与青色信号。',
    author: 'heshuoshuo0512 / Orahako',
    homepage: 'https://github.com/Youwenqwq/ysu-client/pull/21',
    categories: ['theme'],
    versions: [{
      version: '1.0.1',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/ysu.theme.arknights/1.0.1.zip',
      sha256: '796489cc3153eb6963f7dc0e6beff7ceee02d72b5835543f655c965858384f09',
      size: 7166,
      publishedAt: '2026-11-13T10:04:29Z',
      changelog: '迁移至 Orahako 公共模块。',
    }],
  }, {
    id: 'community.perlica-toybox',
    name: 'Perlica 佩黎卡',
    summary: '地图找车、扫码或车辆号解锁、骑行控制、历史记录与账户管理。首个完整外部社区功能插件。',
    author: 'Youwenqwq / Orahako community',
    homepage: 'https://github.com/Youwenqwq/ysu-client',
    categories: ['toybox', 'transport'],
    versions: [{
      version: '1.0.1',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/community.perlica-toybox/1.0.1.zip',
      sha256: '31db6fd3e71eb808919cf14bfb598e2ce192331c2981d695aa9e75956bbc42e0',
      size: 209275,
      publishedAt: '2026-11-13T10:04:29Z',
      changelog: '迁移至 Orahako 公共模块。',
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
