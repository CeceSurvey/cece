#!/usr/bin/env bash
# =============================================================
#  测策 · APK 构建脚本
#
#  在 Windows(Git Bash) / macOS / Linux 下均可运行，需要：
#    - JDK 17
#    - Android build-tools（提供 aapt2 / zipalign / d8 / apksigner）
#    - android.jar（platform，编译期引用）
#
#  工具链位置通过环境变量指定，未指定时按默认目录自动探测：
#    JAVA_HOME       JDK 根目录
#    ANDROID_BUILD   本地工具链根目录（其下含 jdk*、sdk/*）
#
#  用法：
#    bash android/build.sh
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$SCRIPT_DIR"

# ---------- 定位工具链 -----------------------------------------
TOOLCHAIN_ROOT="${ANDROID_BUILD:-/d/_apkbuild}"

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(ls -d "$TOOLCHAIN_ROOT"/jdk* 2>/dev/null | head -1 || true)"
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "✗ 找不到 JDK。请设置 JAVA_HOME 指向 JDK 17+ 根目录。" >&2
  exit 1
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

BUILD_TOOLS="$(dirname "$(ls -d "$TOOLCHAIN_ROOT"/sdk/*/aapt2.exe "$TOOLCHAIN_ROOT"/sdk/*/aapt2 2>/dev/null | head -1)")"
ANDROID_JAR="$(ls "$TOOLCHAIN_ROOT"/sdk/*/android.jar 2>/dev/null | head -1 || true)"

if [ ! -d "${BUILD_TOOLS:-}" ]; then
  echo "✗ 找不到 Android build-tools（aapt2）。" >&2
  exit 1
fi
if [ -z "${ANDROID_JAR:-}" ] || [ ! -f "$ANDROID_JAR" ]; then
  echo "✗ 找不到 android.jar（platform）。" >&2
  exit 1
fi

AAPT2="$BUILD_TOOLS/aapt2"
ZIPALIGN="$BUILD_TOOLS/zipalign"
D8_JAR="$BUILD_TOOLS/lib/d8.jar"
APKSIGNER_JAR="$BUILD_TOOLS/lib/apksigner.jar"
[ -f "$AAPT2.exe" ] && AAPT2="$AAPT2.exe"
[ -f "$ZIPALIGN.exe" ] && ZIPALIGN="$ZIPALIGN.exe"

# ---------- 版本号以 AndroidManifest.xml 为唯一来源 -------------
MANIFEST_SRC="$ANDROID_DIR/AndroidManifest.xml"
VERSION_NAME="$(grep -o 'android:versionName="[^"]*"' "$MANIFEST_SRC" | head -1 | sed 's/.*="//; s/"$//')"
VERSION_CODE="$(grep -o 'android:versionCode="[^"]*"' "$MANIFEST_SRC" | head -1 | sed 's/.*="//; s/"$//')"

# ---------- 工作目录（纯 ASCII，规避中文路径编码问题）----------
WORK="${ANDROID_BUILD_WORK:-$TOOLCHAIN_ROOT/work}"
rm -rf "$WORK"
mkdir -p "$WORK"/{assets/www,gen,classes,dex,out}

echo "============================================================"
echo " 测策 APK 构建"
echo " 版本        : $VERSION_NAME ($VERSION_CODE)"
echo " JDK         : $JAVA_HOME"
echo " build-tools : $BUILD_TOOLS"
echo " platform    : $ANDROID_JAR"
echo " 工作目录    : $WORK"
echo "============================================================"

# ---------- 1. 收集前端资源 -----------------------------------
echo ""
echo "[1/7] 收集前端资源 → assets/www"
for f in index.html core.js app.js styles.css manifest.json icon.svg icon-maskable.svg; do
  if [ ! -f "$PROJECT_ROOT/$f" ]; then
    echo "  ✗ 缺少前端文件: $f" >&2
    exit 1
  fi
  cp "$PROJECT_ROOT/$f" "$WORK/assets/www/$f"
done
python "$ANDROID_DIR/tools/patch-web.py" "$WORK/assets/www/app.js"
echo "  资源清单:"
(cd "$WORK/assets/www" && ls -1 | sed 's/^/    /')

# ---------- 2. 复制原生工程 -----------------------------------
echo ""
echo "[2/7] 复制原生工程"
cp "$MANIFEST_SRC" "$WORK/AndroidManifest.xml"
cp -r "$ANDROID_DIR/src" "$WORK/src"
cp -r "$ANDROID_DIR/res" "$WORK/res"
echo "  Java 源文件: $(find "$WORK/src" -name '*.java' | wc -l) 个"
echo "  资源文件  : $(find "$WORK/res" -type f | wc -l) 个"

# ---------- 3. 编译资源 ---------------------------------------
echo ""
echo "[3/7] aapt2 编译资源"
"$AAPT2" compile --dir "$WORK/res" -o "$WORK/out/res.zip"

cd "$WORK"
echo "[3/7] aapt2 链接生成基础 APK"
"$AAPT2" link \
  -o "$WORK/out/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$WORK/AndroidManifest.xml" \
  -A "$WORK/assets" \
  --java "$WORK/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  "$WORK/out/res.zip"

# ---------- 4. 编译 Java --------------------------------------
echo ""
echo "[4/7] javac 编译 Java 源码"
JAVA_SOURCES="$(find "$WORK/src" "$WORK/gen" -name '*.java' 2>/dev/null | tr '\n' ' ')"
# shellcheck disable=SC2086
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn \
  -bootclasspath "$ANDROID_JAR" \
  -d "$WORK/classes" \
  $JAVA_SOURCES 2>/dev/null || \
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn \
  -classpath "$ANDROID_JAR" \
  -d "$WORK/classes" \
  $JAVA_SOURCES

# ---------- 5. dex --------------------------------------------
echo ""
echo "[5/7] d8 转换字节码为 DEX"
java -cp "$D8_JAR" com.android.tools.r8.D8 \
  --release \
  --min-api 24 \
  --lib "$ANDROID_JAR" \
  --output "$WORK/dex" \
  $(find "$WORK/classes" -name '*.class')

python - "$WORK/out/base.apk" "$WORK/dex/classes.dex" <<'PY'
import shutil, sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + ".tmp"
with zipfile.ZipFile(apk, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        zout.writestr(item, zin.read(item.filename))
    zout.write(dex, "classes.dex")
shutil.move(tmp, apk)
print("  classes.dex 已写入 APK")
PY

# ---------- 6. 对齐 ------------------------------------------
echo ""
echo "[6/7] zipalign 4 字节对齐"
"$ZIPALIGN" -f -p 4 "$WORK/out/base.apk" "$WORK/out/aligned.apk"

# ---------- 7. 签名 ------------------------------------------
echo ""
echo "[7/7] apksigner 签名"

KS_DIR="$ANDROID_DIR/keystore"
KS_FILE="$KS_DIR/chaiyichai-release.jks"
KS_ALIAS="${KS_ALIAS:-chaiyichai}"
KS_PASS="${KS_PASS:-chaiyichai2026}"

mkdir -p "$KS_DIR"
if [ ! -f "$KS_FILE" ]; then
  echo "  首次构建，生成签名密钥库"
  keytool -genkeypair \
    -keystore "$WORK/ks.jks" \
    -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=ChaiYiChai, OU=ChaiYiChai, O=ChaiYiChai, L=ChaiYiChai, ST=ChaiYiChai, C=CN" \
    -storetype PKCS12 >/dev/null 2>&1
  cp "$WORK/ks.jks" "$KS_FILE"
  echo "  密钥库已保存: android/keystore/chaiyichai-release.jks"
else
  cp "$KS_FILE" "$WORK/ks.jks"
fi

java -jar "$APKSIGNER_JAR" sign \
  --ks "$WORK/ks.jks" \
  --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" \
  --key-pass "pass:$KS_PASS" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$WORK/out/cece.apk" \
  "$WORK/out/aligned.apk"

# ---------- 8. 校验并交付 -------------------------------------
echo ""
echo "校验签名"
java -jar "$APKSIGNER_JAR" verify --print-certs "$WORK/out/cece.apk" | sed 's/^/  /'

DIST="$PROJECT_ROOT/dist"
mkdir -p "$DIST"
FINAL="$DIST/测策-v$VERSION_NAME.apk"
cp "$WORK/out/cece.apk" "$FINAL"

SIZE="$(du -k "$FINAL" | cut -f1)"
echo ""
echo "============================================================"
echo " 构建成功"
echo " 产物: dist/测策-v$VERSION_NAME.apk  (${SIZE} KB)"
echo "============================================================"
