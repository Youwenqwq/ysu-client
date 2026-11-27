import type { NativeNotificationChannelSpec } from "@orahako/sdk"

export const YSU_NOTIFICATION_CHANNELS: readonly NativeNotificationChannelSpec[] = [
  {
    id: "orahako_grades",
    name: "成绩通知",
    description: "新成绩发布或成绩变更提醒",
    importance: "high",
    sound: true,
    vibration: true,
    showBadge: true,
    lockscreenVisibility: "public",
  },
  {
    id: "orahako_exams",
    name: "考试安排",
    description: "新考试安排或考场变更提醒",
    importance: "high",
    sound: true,
    vibration: true,
    showBadge: true,
    lockscreenVisibility: "public",
  },
  {
    id: "orahako_auth",
    name: "登录状态",
    description: "教务登录凭证过期提醒",
    importance: "default",
    sound: true,
    vibration: true,
    showBadge: true,
    lockscreenVisibility: "public",
  },
  {
    id: "orahako_errors",
    name: "后台同步异常",
    description: "后台检查网络或教务接口异常提示",
    importance: "low",
    sound: false,
    vibration: false,
    showBadge: false,
  },
]

/**
 * Self-contained headless QuickJS background worker script for YSU grade/exam
 * polling. Executed inside `background.tasks@1` with zero Kotlin school code.
 */
export const YSU_BACKGROUND_WORKER_SCRIPT = `(function () {
  var MAX_CONSECUTIVE_FAILURES = 3;
  var MAX_INDIVIDUAL_NOTIFICATIONS = 5;
  var LOGIN_MARKER = /authserver\\/login|reAuthCheck|isMultifactor|reAuthType|二次认证|<input\\b[^>]*\\btype\\s*=\\s*["']?password\\b/i;

  function createCookieJar() {
    var cookies = [];
    function parseHost(url) {
      var m = /^https?:\\/\\/([^\\/:?#]+)/i.exec(url || '');
      return m ? m[1].toLowerCase() : '';
    }
    function parsePath(url) {
      var m = /^https?:\\/\\/[^\\/?#]+([^?#]*)/i.exec(url || '');
      return m && m[1] ? m[1] : '/';
    }
    function domainMatches(cookieDomain, host) {
      if (!cookieDomain) return false;
      var d = cookieDomain.toLowerCase();
      if (d.charAt(0) === '.') d = d.slice(1);
      return host === d || host.endsWith('.' + d);
    }
    return {
      set(name, value, domain, path) {
        var d = String(domain || '').toLowerCase();
        var p = path || '/';
        cookies = cookies.filter(function (c) {
          return !(c.name === name && c.domain === d && c.path === p);
        });
        cookies.push({ name: name, value: value, domain: d, path: p });
      },
      saveFromResponse(url, setCookies) {
        if (!Array.isArray(setCookies)) return;
        var defaultHost = parseHost(url);
        for (var i = 0; i < setCookies.length; i++) {
          var raw = String(setCookies[i] || '');
          var parts = raw.split(';');
          var nv = parts[0].trim();
          var eq = nv.indexOf('=');
          if (eq <= 0) continue;
          var name = nv.slice(0, eq).trim();
          var value = nv.slice(eq + 1).trim();
          var domain = defaultHost;
          var path = '/';
          var expired = false;
          for (var j = 1; j < parts.length; j++) {
            var attr = parts[j].trim();
            var aeq = attr.indexOf('=');
            var ak = (aeq >= 0 ? attr.slice(0, aeq) : attr).trim().toLowerCase();
            var av = aeq >= 0 ? attr.slice(aeq + 1).trim() : '';
            if (ak === 'domain' && av) domain = av.toLowerCase();
            else if (ak === 'path' && av) path = av;
            else if (ak === 'max-age' && Number(av) <= 0) expired = true;
          }
          cookies = cookies.filter(function (c) {
            return !(c.name === name && c.domain === domain && c.path === path);
          });
          if (!expired) cookies.push({ name: name, value: value, domain: domain, path: path });
        }
      },
      headerFor(url) {
        var host = parseHost(url);
        var reqPath = parsePath(url);
        var matched = [];
        for (var i = 0; i < cookies.length; i++) {
          var c = cookies[i];
          if (domainMatches(c.domain, host) && reqPath.startsWith(c.path)) {
            matched.push(c.name + '=' + c.value);
          }
        }
        return matched.join('; ');
      }
    };
  }

  function resolveUrl(base, location) {
    if (!location) return '';
    if (/^https?:\\/\\//i.test(location)) return location;
    var originMatch = /^(https?:\\/\\/[^\\/?#]+)/i.exec(base);
    var origin = originMatch ? originMatch[1] : '';
    if (location.charAt(0) === '/') return origin + location;
    var dir = base.replace(/[?#].*$/, '').replace(/[^\\/]*$/, '');
    return dir + location;
  }

  function firstValue(obj, keys) {
    if (!obj || !Array.isArray(keys)) return '';
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  function normalizeGrade(raw, mappings) {
    var g = (mappings && mappings.grade) || {};
    return {
      record_id: firstValue(raw, g.record_id || ['WID']),
      class_id: firstValue(raw, g.class_id || ['JXBID']),
      course_name: firstValue(raw, g.course_name || ['XSKCM', 'KCM']),
      course_code: firstValue(raw, g.course_code || ['XSKCH', 'KCH']),
      score: firstValue(raw, g.score || ['ZCJ', 'XSZCJMC']),
      grade_level: firstValue(raw, g.grade_level || ['XSZCJMC']),
      grade_point: firstValue(raw, g.grade_point || ['XFJD']),
      term: firstValue(raw, g.term || ['XNXQDM']),
      exam_type: firstValue(raw, g.exam_type || ['KSLXDM_DISPLAY', 'KSLXDM']),
      is_pass: firstValue(raw, g.is_pass || ['SFJG']),
      is_retake: firstValue(raw, g.is_retake || ['CXCKDM_DISPLAY'])
    };
  }

  function normalizeExam(raw, mappings) {
    var e = (mappings && mappings.exam) || {};
    return {
      name: firstValue(raw, e.name || ['KCM']),
      exam_name: firstValue(raw, e.exam_name || ['KSMC']),
      exam_location: firstValue(raw, e.exam_location || ['JASMC']),
      seat_number: firstValue(raw, e.seat_number || ['ZWH']),
      time_text: String(raw.KSSJMS || raw.KSRQ || '').replace(/<[^>]*>/g, '').trim()
    };
  }

  function gradeIdentity(g) {
    if (g.record_id) return 'id:' + g.record_id;
    return [g.term, g.course_code || g.course_name, g.class_id, g.exam_type, g.is_retake].join('|');
  }

  function gradeResultSig(g) {
    return [g.score, g.grade_level, g.grade_point, g.is_pass].join('|');
  }

  function diffGrades(oldList, newList) {
    var oldByKey = Object.create(null);
    for (var i = 0; i < oldList.length; i++) {
      var og = oldList[i];
      oldByKey[gradeIdentity(og)] = gradeResultSig(og);
    }
    var changed = [];
    for (var j = 0; j < newList.length; j++) {
      var ng = newList[j];
      var key = gradeIdentity(ng);
      if (!(key in oldByKey) || oldByKey[key] !== gradeResultSig(ng)) {
        changed.push(ng);
      }
    }
    return changed;
  }

  function examSig(e) {
    return [e.name, e.exam_name, e.time_text, e.exam_location, e.seat_number].join('|');
  }

  function diffExams(oldList, newList) {
    var seen = Object.create(null);
    for (var i = 0; i < oldList.length; i++) seen[examSig(oldList[i])] = true;
    var added = [];
    for (var j = 0; j < newList.length; j++) {
      if (!seen[examSig(newList[j])]) added.push(newList[j]);
    }
    return added;
  }

  async function readJson(storage, key, fallback) {
    var raw = await storage.getItem(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  globalThis.__orahakoBackgroundTask = async function (ctx, payload) {
    var castgc = String((payload && payload.castgc) || '').trim();
    var serverConfig = payload && payload.serverConfig;
    if (!castgc || !serverConfig) return 'skipped';

    var providerId = String(payload.providerId || 'ysu');
    var accountHash = String(payload.accountHash || '');
    var checkGrades = payload.checkGrades !== false;
    var checkExams = payload.checkExams !== false;
    var notifyNetworkError = payload.notifyNetworkError === true;
    if (!checkGrades && !checkExams) return 'skipped';

    var identity = providerId + ':' + accountHash;
    var prevIdentity = await ctx.storage.getItem('identity');
    if (prevIdentity !== identity) {
      await ctx.storage.setItem('identity', identity);
      await ctx.storage.removeItem('grades_baseline');
      await ctx.storage.removeItem('exams_baseline');
      await ctx.storage.removeItem('session_expired');
      await ctx.storage.removeItem('failures');
    }

    var prevCastgc = await ctx.storage.getItem('castgc');
    if (prevCastgc !== castgc) {
      await ctx.storage.setItem('castgc', castgc);
      await ctx.storage.setItem('session_expired', '0');
    }
    if ((await ctx.storage.getItem('session_expired')) === '1') {
      return 'skipped';
    }

    var channels = [
      { id: 'orahako_grades', name: '成绩通知', description: '新成绩发布或成绩变更提醒', importance: 'high', sound: true, vibration: true, lockscreenVisibility: 'public' },
      { id: 'orahako_exams', name: '考试安排', description: '新考试安排或考场变更提醒', importance: 'high', sound: true, vibration: true, lockscreenVisibility: 'public' },
      { id: 'orahako_auth', name: '登录状态', description: '教务登录凭证过期提醒', importance: 'default', sound: true, vibration: true, lockscreenVisibility: 'public' },
      { id: 'orahako_errors', name: '后台同步异常', description: '后台检查网络或教务接口异常提示', importance: 'low', sound: false, vibration: false }
    ];
    for (var c = 0; c < channels.length; c++) {
      await ctx.notifications.ensureChannel(channels[c]);
    }

    var jar = createCookieJar();
    var cerBase = String(serverConfig.cerBaseUrl || '').replace(/\\/+$/, '');
    var jwxtBase = String(serverConfig.jwxtBaseUrl || '').replace(/\\/+$/, '');
    var appBase = jwxtBase + '/jwapp/sys';
    var cerHostMatch = /^https?:\\/\\/([^\\/:?#]+)/i.exec(cerBase);
    if (cerHostMatch) {
      jar.set('CASTGC', castgc, cerHostMatch[1], '/authserver');
    }

    async function httpReq(url, opts) {
      var headers = Object.assign({
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }, (opts && opts.headers) || {});
      var cookieHeader = jar.headerFor(url);
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      var resp = await ctx.http.send({
        url: url,
        method: (opts && opts.method) || 'GET',
        headers: headers,
        body: opts && opts.body,
        followRedirects: false
      });
      jar.saveFromResponse(url, resp.setCookies);
      return resp;
    }

    function makeSessionExpiredError(msg) {
      var err = new Error(msg || 'SESSION_EXPIRED');
      err.code = 'SESSION_EXPIRED';
      return err;
    }

    async function establishSession() {
      var portalUrl = appBase + '/emaphome/portal/index.do';
      var currentUrl = cerBase + '/authserver/login?service=' + encodeURIComponent(portalUrl);
      for (var hop = 0; hop < 10; hop++) {
        var resp = await httpReq(currentUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        if (resp.status >= 300 && resp.status < 400 && resp.headers && resp.headers.location) {
          var nextUrl = resolveUrl(currentUrl, resp.headers.location);
          if (nextUrl.indexOf('/authserver/login') >= 0 && hop > 0) return false;
          currentUrl = nextUrl;
          continue;
        }
        if (resp.status >= 200 && resp.status < 300) {
          if (LOGIN_MARKER.test(resp.body || '')) return false;
          return currentUrl.indexOf(jwxtBase) === 0;
        }
        if (resp.status === 401 || resp.status === 403) return false;
        throw new Error('Unexpected CAS/JWXT HTTP ' + resp.status);
      }
      return false;
    }

    async function fetchWeu(appId) {
      if (!appId) return;
      var url = appBase + '/emaphome/appShow.do?id=' + encodeURIComponent(appId);
      var resp = await httpReq(url, {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
      });
      if (resp.status === 401 || resp.status === 403) throw makeSessionExpiredError('appShow ' + resp.status);
      if (resp.status >= 300 && resp.status < 400 && resp.headers && resp.headers.location) {
        if (resp.headers.location.indexOf('/authserver/login') >= 0) throw makeSessionExpiredError('appShow redirect to login');
      } else if (resp.status === 200 && LOGIN_MARKER.test(resp.body || '')) {
        throw makeSessionExpiredError('appShow login html');
      } else if (resp.status !== 200) {
        throw new Error('appShow HTTP ' + resp.status);
      }
    }

    async function postEmapRows(apiPath, bodyParams, dataKey) {
      if (!apiPath) return [];
      var cleanPath = String(apiPath).replace(/^\\/+/, '');
      var dataUrl = cleanPath.indexOf('jwapp/sys/') === 0 ? (jwxtBase + '/' + cleanPath) : (appBase + '/' + cleanPath);
      var resp = await httpReq(dataUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01'
        },
        body: bodyParams || ''
      });
      if (resp.status === 401 || resp.status === 403) throw makeSessionExpiredError('EMAP HTTP ' + resp.status);
      if (resp.status >= 300 && resp.status < 400) {
        var loc = (resp.headers && resp.headers.location) || '';
        if (loc.indexOf('/authserver/login') >= 0) throw makeSessionExpiredError('EMAP redirect to login');
        throw new Error('Unexpected EMAP redirect ' + resp.status);
      }
      if (LOGIN_MARKER.test(resp.body || '')) throw makeSessionExpiredError('EMAP login html');
      if (resp.status !== 200) throw new Error('EMAP HTTP ' + resp.status);
      var parsed = JSON.parse(resp.body || '{}');
      var code = parsed && parsed.code;
      if (String(code) !== '0') {
        throw new Error('EMAP business error: code=' + code + ' ' + (parsed.msg || ''));
      }
      var datas = parsed && parsed.datas;
      if (!datas || typeof datas !== 'object') throw new Error('EMAP missing datas');
      if (dataKey && datas[dataKey] && Array.isArray(datas[dataKey].rows)) {
        return datas[dataKey].rows;
      }
      var keys = Object.keys(datas);
      for (var i = 0; i < keys.length; i++) {
        var block = datas[keys[i]];
        if (block && Array.isArray(block.rows)) return block.rows;
      }
      throw new Error('EMAP missing rows for ' + (dataKey || cleanPath));
    }

    var nowIso = new Date().toISOString();
    try {
      var ok = await establishSession();
      if (!ok) {
        console.warn('YSU background session expired');
        await ctx.storage.setItem('session_expired', '1');
        await ctx.storage.setItem('failures', '0');
        await ctx.notifications.post({
          channelId: 'orahako_auth',
          title: '教务登录已过期',
          body: '请打开酸橙盒重新登录以恢复成绩与考试提醒',
          deepLink: 'orahako://settings',
          priority: 'default',
          category: 'status'
        });
        await ctx.state.setDiagnostics({ lastRunAt: nowIso, sessionExpired: true, failures: 0 });
        return 'success';
      }

      var gradeCount = 0;
      var examCount = 0;
      var apiPaths = serverConfig.apiPaths || {};

      if (checkGrades && apiPaths.grades) {
        await fetchWeu(apiPaths.grades.appId);
        var querySetting = JSON.stringify([
          { name: 'SFYX', value: '1', linkOpt: 'and', builder: 'm_value_equal' },
          { name: 'SHOWMAXCJ', value: 0, linkOpt: 'and', builder: 'equal' },
          { name: 'BY1', value: '1', linkOpt: 'and', builder: 'equal' }
        ]);
        var gradeBody = 'querySetting=' + encodeURIComponent(querySetting) + '&pageSize=999&pageNumber=1&*order=-XNXQDM,-KCH,-KXH';
        var rawGrades = await postEmapRows(apiPaths.grades.path, gradeBody, 'xscjcx');
        var grades = rawGrades.map(function (r) { return normalizeGrade(r, serverConfig.fieldMappings); });
        gradeCount = grades.length;
        var prevGrades = await readJson(ctx.storage, 'grades_baseline', null);
        if (prevGrades === null) {
          await ctx.storage.setItem('grades_baseline', JSON.stringify(grades));
        } else {
          var gDiff = diffGrades(prevGrades, grades);
          if (gDiff.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
            await ctx.notifications.post({
              channelId: 'orahako_grades',
              title: '新成绩发布',
              body: '共更新 ' + gDiff.length + ' 门课程成绩，点击查看详情',
              deepLink: 'orahako://grades',
              priority: 'high',
              category: 'status'
            });
          } else {
            for (var gi = 0; gi < gDiff.length; gi++) {
              var item = gDiff[gi];
              await ctx.notifications.post({
                channelId: 'orahako_grades',
                title: '新成绩发布',
                body: (item.course_name || '课程') + (item.score ? '：' + item.score : ' 成绩已更新'),
                deepLink: 'orahako://grades',
                priority: 'high',
                category: 'status'
              });
            }
          }
          await ctx.storage.setItem('grades_baseline', JSON.stringify(grades));
        }
      }

      if (checkExams && apiPaths.exams) {
        await fetchWeu(apiPaths.exams.appId);
        var term = '';
        if (apiPaths.currentTerm && apiPaths.currentTerm.path) {
          var termRows = await postEmapRows(apiPaths.currentTerm.path, '', 'dqxnxq');
          term = termRows && termRows[0] && termRows[0].DM ? String(termRows[0].DM).trim() : '';
        }
        var examBody = term
          ? ('requestParamStr=' + encodeURIComponent(JSON.stringify({ XNXQDM: term, '*order': '-KSRQ,-KSSJMS' })))
          : 'pageSize=999&pageNumber=1';
        var rawExams = await postEmapRows(apiPaths.exams.path, examBody, 'cxxsksap');
        var exams = rawExams.map(function (r) { return normalizeExam(r, serverConfig.fieldMappings); });
        examCount = exams.length;
        var prevExams = await readJson(ctx.storage, 'exams_baseline', null);
        if (prevExams === null) {
          await ctx.storage.setItem('exams_baseline', JSON.stringify(exams));
        } else {
          var eDiff = diffExams(prevExams, exams);
          if (eDiff.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
            await ctx.notifications.post({
              channelId: 'orahako_exams',
              title: '考试安排更新',
              body: '共新增或更新 ' + eDiff.length + ' 场考试安排，点击查看详情',
              deepLink: 'orahako://exams',
              priority: 'high',
              category: 'event'
            });
          } else {
            for (var ei = 0; ei < eDiff.length; ei++) {
              var ex = eDiff[ei];
              var detail = [ex.time_text, ex.exam_location].filter(Boolean).join(' ');
              await ctx.notifications.post({
                channelId: 'orahako_exams',
                title: '考试安排更新',
                body: (ex.name || '考试') + (detail ? ' · ' + detail : ''),
                deepLink: 'orahako://exams',
                priority: 'high',
                category: 'event'
              });
            }
          }
          await ctx.storage.setItem('exams_baseline', JSON.stringify(exams));
        }
      }

      console.log('YSU background poll succeeded: grades=' + gradeCount + ', exams=' + examCount);
      await ctx.storage.setItem('failures', '0');
      await ctx.state.setDiagnostics({
        lastRunAt: nowIso,
        sessionExpired: false,
        failures: 0,
        gradeCount: gradeCount,
        examCount: examCount
      });
      return 'success';
    } catch (err) {
      if (err && err.code === 'SESSION_EXPIRED') {
        console.warn('YSU background session expired:', err.message);
        await ctx.storage.setItem('session_expired', '1');
        await ctx.storage.setItem('failures', '0');
        await ctx.notifications.post({
          channelId: 'orahako_auth',
          title: '教务登录已过期',
          body: '请打开酸橙盒重新登录以恢复成绩与考试提醒',
          deepLink: 'orahako://settings',
          priority: 'default',
          category: 'status'
        });
        await ctx.state.setDiagnostics({ lastRunAt: nowIso, sessionExpired: true, failures: 0 });
        return 'success';
      }
      var failures = Number((await ctx.storage.getItem('failures')) || '0') + 1;
      console.warn('YSU background poll failed (attempt ' + failures + '):', err && err.message ? err.message : String(err));
      await ctx.storage.setItem('failures', String(failures));
      if (notifyNetworkError || failures >= MAX_CONSECUTIVE_FAILURES) {
        await ctx.notifications.post({
          channelId: 'orahako_errors',
          title: '后台教务检查异常',
          body: '连续检查失败（第 ' + failures + ' 次），请稍后检查网络或登录状态',
          deepLink: 'orahako://settings',
          priority: 'low',
          category: 'error',
          silent: true,
          onlyAlertOnce: true
        });
      }
      await ctx.state.setDiagnostics({
        lastRunAt: nowIso,
        sessionExpired: false,
        failures: failures,
        lastError: err && err.message ? err.message : String(err)
      });
      return 'retry';
    }
  };
})();`
