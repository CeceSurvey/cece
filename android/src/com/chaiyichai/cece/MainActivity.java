package com.chaiyichai.cece;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 测策 —— 原生壳。
 *
 * 设计要点：
 * 1. 页面资源通过 https://appassets.androidplatform.net/ 虚拟域名从 assets 读取，
 *    以获得一个「安全来源（secure origin）」，保证 localStorage 稳定落盘
 *    （若用 file:// 加载，WebView 的本地存储行为在各版本上不一致）。
 * 2. 程序完全离线运行，不申请任何网络权限。
 * 3. 原生导出：浏览器里的 <a download> 在 WebView 中无效，
 *    因此由 CeceAndroid.saveArchive() 写入系统「下载/测策」目录。
 * 4. 原生导入：接管文件选择器，让存档文件能被正常选中并交给页面解析。
 * 5. 横竖屏旋转不重建 Activity，避免输入到一半的表格被重置。
 */
public class MainActivity extends Activity {

    /** 虚拟资源域名，仅在本 App 内部使用，不产生真实网络请求 */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ENTRY_URL = "https://" + ASSET_HOST + "/index.html";

    /** 导出目录名（位于系统「下载」之下） */
    private static final String EXPORT_DIR = "测策";

    private static final int REQ_PICK_FILE = 0x5E01;

    private WebView web;
    private ValueCallback<Uri[]> pendingFileCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        web = new WebView(this);
        web.setBackgroundColor(0xFFEEF2F3);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        setContentView(web);

        // 状态栏 / 导航栏保持系统默认避让（内容在系统栏内部），
        // 页面顶栏不再叠加额外的 safe-area padding，避免横竖屏出现厚白边。
        // 「绿边」已通过窗口背景 / 导航栏改用浅色 page_bg 解决，无需让 WebView 铺满系统栏。
        Window win = getWindow();
        win.setNavigationBarColor(0xFFEEF2F3);
        win.setStatusBarColor(0xFF0F5F6B);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);          // 只走虚拟域名，禁止 file:// 读取
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                   // 固定字号，防止系统字体放大撑破表格布局
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);  // 纯离线应用，无需联网校验
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && ASSET_HOST.equals(url.getHost())) {
                    WebResourceResponse res = openAsset(url.getPath());
                    if (res != null) return res;
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && ASSET_HOST.equals(url.getHost())) {
                    return false; // 内部导航，交给 WebView
                }
                // 外部链接（若将来加入说明页链接）交给系统浏览器
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.addJavascriptInterface(new NativeBridge(), "CeceAndroid");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, REQ_PICK_FILE);
                    return true;
                } catch (Exception e) {
                    pendingFileCallback = null;
                    toast("无法打开文件选择器");
                    return false;
                }
            }
        });

        // 首次启动，或进程被回收后无法恢复 WebView 状态时，都回到入口页
        boolean restored = false;
        if (savedInstanceState != null) {
            restored = web.restoreState(savedInstanceState) != null;
        }
        if (!restored) {
            web.loadUrl(ENTRY_URL);
        }
    }

    /** 把虚拟域名的路径映射到 assets/www/，返回可用的响应流 */
    private WebResourceResponse openAsset(String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        String assetPath = "www" + path;
        try {
            InputStream in = getAssets().open(assetPath);
            String mime = mimeOf(path);
            boolean textual = isTextual(mime);
            WebResourceResponse response = new WebResourceResponse(
                    mime, textual ? "utf-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache, no-store, must-revalidate");
            headers.put("X-Content-Type-Options", "nosniff");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            return null; // 交给 WebView 报 404
        }
    }

    private static boolean isTextual(String mime) {
        return mime.startsWith("text/")
                || mime.contains("javascript")
                || mime.contains("json")
                || mime.contains("svg+xml");
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    /** 按扩展名推断导出文件的 MIME（存档 JSON / 成果 CSV / 图片都走这里） */
    private static String mimeByName(String name) {
        String n = name == null ? "" : name.toLowerCase();
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /** 暴露给页面的原生能力 */
    private class NativeBridge {

        /**
         * 导出文本文件（存档 JSON / 成果 CSV）到系统「下载/测策」目录。
         * Android 10+ 走 MediaStore，无需存储权限；更低版本写入应用外部目录。
         *
         * @return 提示文案，由页面直接 toast 出来
         */
        @JavascriptInterface
        public String saveArchive(String fileName, String content) {
            String safe = sanitizeFileName(fileName);
            byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
            return writeText(safe, bytes, mimeByName(safe));
        }

        /**
         * 保存图片（成果图 / 智能纸图）到系统相册 Pictures/测策。
         * 页面传入 canvas 的 base64，带不带 data: 前缀都能处理。
         *
         * @return 提示文案，由页面直接 toast 出来
         */
        @JavascriptInterface
        public String saveImage(String fileName, String base64) {
            if (base64 == null || base64.isEmpty()) return "保存失败：图片数据为空";
            String data = base64;
            int comma = data.indexOf(',');
            if (comma > 0 && data.startsWith("data:")) data = data.substring(comma + 1);
            byte[] bytes;
            try {
                bytes = Base64.decode(data, Base64.DEFAULT);
            } catch (Exception e) {
                return "保存失败：图片数据解码失败";
            }
            if (bytes.length == 0) return "保存失败：图片数据为空";

            String safe = sanitizeFileName(fileName);
            if (!safe.toLowerCase().endsWith(".png")) safe = safe + ".png";
            return writeImage(safe, bytes);
        }

        /** 文本类文件：Android 10+ 进「下载」，更低版本写应用外部目录 */
        private String writeText(String safeName, byte[] bytes, String mime) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    return insertToMediaCollection(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            Environment.DIRECTORY_DOWNLOADS,
                            safeName, bytes, mime,
                            "已导出到「下载/" + EXPORT_DIR + "/" + safeName + "」");
                }
                return writeToLegacyDir(Environment.DIRECTORY_DOWNLOADS, safeName, bytes);
            } catch (Exception e) {
                return "导出失败：" + describe(e);
            }
        }

        /** 图片：Android 10+ 进相册，更低版本写应用外部目录 */
        private String writeImage(String safeName, byte[] bytes) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    return insertToMediaCollection(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                            Environment.DIRECTORY_PICTURES,
                            safeName, bytes, "image/png",
                            "已保存到相册「Pictures/" + EXPORT_DIR + "/" + safeName + "」");
                }
                return writeToLegacyDir(Environment.DIRECTORY_PICTURES, safeName, bytes);
            } catch (Exception e) {
                return "保存失败：" + describe(e);
            }
        }

        /** 写入系统媒体库（Android 10+ 免存储权限） */
        private String insertToMediaCollection(Uri collection, String typeDir,
                                               String safeName, byte[] bytes, String mime,
                                               String okMessage) throws IOException {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, typeDir + File.separator + EXPORT_DIR);
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);

            Uri uri = getContentResolver().insert(collection, cv);
            if (uri == null) throw new IOException("无法创建文件");

            OutputStream os = getContentResolver().openOutputStream(uri);
            if (os == null) throw new IOException("无法写入文件");
            try {
                os.write(bytes);
                os.flush();
            } finally {
                os.close();
            }

            cv.clear();
            cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, cv, null, null);
            return okMessage;
        }

        /** Android 9 及以下的落盘位置，同样无需存储权限 */
        private String writeToLegacyDir(String typeDir, String safeName, byte[] bytes) throws IOException {
            File base = getExternalFilesDir(typeDir);
            if (base == null) base = getFilesDir();
            File dir = new File(base, EXPORT_DIR);
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");

            File f = new File(dir, safeName);
            FileOutputStream fos = new FileOutputStream(f);
            try {
                fos.write(bytes);
                fos.flush();
            } finally {
                fos.close();
            }
            return "已保存到「" + f.getAbsolutePath() + "」";
        }

        /** 供页面探测原生环境 */
        @JavascriptInterface
        public boolean isNative() {
            return true;
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String appVersion() {
            return versionName();
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        return (m == null || m.isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    private static String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) name = "cece-export";
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_").trim();
        // 去掉 Windows 不允许的结尾点号与空格
        cleaned = cleaned.replaceAll("[. ]+$", "");
        if (cleaned.isEmpty()) cleaned = "cece-export";
        if (cleaned.length() > 80) {
            int dot = cleaned.lastIndexOf('.');
            if (dot > 0 && cleaned.length() - dot <= 12) {
                cleaned = cleaned.substring(0, 80 - (cleaned.length() - dot)) + cleaned.substring(dot);
            } else {
                cleaned = cleaned.substring(0, 80);
            }
        }
        return cleaned;
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PICK_FILE) {
            if (pendingFileCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
                // 把读权限授予 WebView，页面才能读到文件内容
                if (results != null) {
                    for (Uri uri : results) {
                        try {
                            grantUriPermission(getPackageName(), uri,
                                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * 返回键：优先回退到页面上一级（工作区 → 存档管理 → 首页），
     * 只在首页时才退出，避免误触把正在编辑的存档关掉。
     */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){"
                        + "var a=document.querySelector('.screen.is-active');"
                        + "if(!a) return 'home';"
                        + "var n=a.getAttribute('data-screen');"
                        + "if(n==='project'){var b=document.getElementById('wsBack');if(b){b.click();return 'handled';}}"
                        + "else if(n&&n!=='home'){var h=document.querySelector('[data-nav=\"home\"]');if(h){h.click();return 'handled';}}"
                        + "return n||'home';"
                        + "})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.contains("home")) {
                            finish();
                        }
                    }
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
