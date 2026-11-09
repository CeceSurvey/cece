#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 app.js 注入原生导出钩子（仅作用于打包副本，不改动源文件）。

WebView 里 <a download> + blob: 不会触发下载，因此在导出函数最前面
插入一段特性检测：若存在 window.CeceAndroid.saveArchive 就交给原生落盘，
否则继续走原来的浏览器下载逻辑。Web 版行为完全不变。
"""
import io
import os
import sys

ANCHOR = (
    "  const blob = new Blob([JSON.stringify(payload, null, 2)], "
    "{ type: 'application/json;charset=utf-8' });"
)

INJECT = """  /* 原生壳：<a download> 在 WebView 中无效，交给原生写入「下载/测策」 */
  if (window.CeceAndroid && window.CeceAndroid.saveArchive) {
    try {
      const nativeMsg = window.CeceAndroid.saveArchive(
        safeFileName(project.name) + '.cece.json',
        JSON.stringify(payload, null, 2)
      );
      toast(nativeMsg || '已导出');
    } catch (e) {
      toast('导出失败：' + (e.message || '原生保存异常'));
    }
    return;
  }

"""


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: patch-web.py <app.js 路径>")
        return 2
    path = sys.argv[1]
    if not os.path.isfile(path):
        print("  [错误] 找不到 " + path)
        return 1

    raw = io.open(path, "rb").read()

    if b"CeceAndroid" in raw:
        print("  app.js 已含原生导出钩子，跳过")
        return 0

    crlf = b"\r\n" in raw
    anchor = ANCHOR.encode("utf-8")
    inject = INJECT.encode("utf-8")
    if crlf:
        anchor = anchor.replace(b"\n", b"\r\n")
        inject = inject.replace(b"\n", b"\r\n")

    if anchor not in raw:
        print("  [警告] 未定位到导出锚点，跳过原生导出钩子（导出将退回浏览器逻辑）")
        return 0

    patched = raw.replace(anchor, inject + anchor, 1)
    io.open(path, "wb").write(patched)
    print("  已注入原生导出钩子")
    return 0


if __name__ == "__main__":
    sys.exit(main())
