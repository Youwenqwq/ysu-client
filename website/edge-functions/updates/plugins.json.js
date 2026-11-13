const DEFAULT_INDEX = {
  schemaVersion: 1,
  updatedAt: '2026-11-13T13:33:23Z',
  plugins: [{
    id: 'community.theme.arknights',
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
      zipUrl: '/plugins/community.theme.arknights/1.0.1.zip',
      sha256: '150b3d7f21dcbf9a4599141c987281c3ff7fe4e29cb324abdf1b29f1c8658e7c',
      size: 7175,
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
  }, {
    id: 'zmu.provider',
    name: '遵义医科大学教务',
    summary: '验证码登录、学籍、课表、成绩与考试查询。',
    author: 'Orahako',
    homepage: 'https://github.com/Youwenqwq/ysu-client',
    categories: ['provider', 'school'],
    versions: [{
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/zmu.provider/1.0.0.zip',
      sha256: '2e306b0fe5f80e852b22796345a34a650533409b3078853a40e415688bf0dad0',
      size: 7003,
      publishedAt: '2026-11-13T12:53:43Z',
      changelog: '首个乘方教务 Provider。',
    }],
  }, {
    id: 'orahako.skbird',
    name: '森空鸟',
    summary: '热榜、帖子、消息与个人账户。',
    author: 'Orahako',
    homepage: 'https://github.com/Youwenqwq/ysu-client',
    categories: ['toybox'],
    versions: [{
      version: '1.0.1',
      apiVersion: 1,
      minAppVersion: '0.15.0',
      platforms: ['web', 'android'],
      zipUrl: '/plugins/orahako.skbird/1.0.1.zip',
      sha256: 'a9e64700644213802de090bcb5ac99108636ab23c4aee6b500bd51bae57e9940',
      size: 20121,
      publishedAt: '2026-11-13T13:33:23Z',
      changelog: '从内置功能迁移为官方市场插件。',
    }],
  }],
  bundles: [{
    id: 'ysu.essentials',
    name: '燕大常用功能',
    schoolId: 'ysu',
    pluginIds: [
      'orahako.overview',
      'orahako.schedule',
      'orahako.grades',
      'orahako.exams',
      'orahako.student-info',
      'orahako.skbird',
    ],
  }, {
    id: 'zmu.essentials',
    name: '遵医常用功能',
    schoolId: 'zmu',
    pluginIds: [
      'orahako.overview',
      'orahako.schedule',
      'orahako.grades',
      'orahako.exams',
      'orahako.student-info',
      'orahako.skbird',
    ],
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
