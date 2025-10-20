const fs = require('fs-extra');
const path = require('path');
const terser = require('terser');
const htmlMinifier = require('html-minifier-terser');
const CleanCSS = require('clean-css');

// --- 核心配置：目标目录 ---
const TARGET_DIR = 'dist';
const INDEX_HTML = path.join(TARGET_DIR, 'index.html');
const FAVICON_ICO = path.join(TARGET_DIR, 'favicon.ico');

// 实例化 CleanCSS
const cleanCss = new CleanCSS({});
// -----------------------------

// 正则表达式用于匹配 index.html 中对外部 JS、CSS 和 Favicon 的引用
const JS_REGEX = /<script\s+(?:type="text\/javascript"\s+)?src="([^"]+\.js)"\s*><\/script>/gi;
const CSS_LINK_REGEX = /<link\s+rel="stylesheet"\s+href="([^"]+\.css)"(?:\s+\/)?\s*>/gi;
const FAVICON_REGEX = /(<link\s+[^>]*?rel="(?:icon|shortcut\s+icon)"[^>]*?href="([^"]+\.ico)"[^>]*?>)/gi;

// 正则表达式用于匹配 CSS 文件中的 url() 引用
const CSS_URL_REGEX = /url\(['"]?([^'"\)]+\.(?:ttf|woff2))['"]?\)/gi;

/**
 * 映射文件扩展名到 Base64 Data URI 的 MIME Type
 */
const MIME_MAP = {
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    // 可以在这里添加其他需要内联的类型，如 .png: 'image/png'
};

/**
 * 将二进制文件转换为 Base64 Data URI
 * @param {string} filePath 文件路径
 * @returns {Promise<string|null>} Data URI 字符串
 */
async function convertAssetToBase64(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[ext];

    if (!mimeType) {
        console.warn(`\t⚠️ 警告：不支持的 Base64 转换类型: ${ext} - ${path.basename(filePath)}`);
        return null;
    }

    try {
        // 读取二进制文件
        const buffer = await fs.readFile(filePath);
        const base64 = buffer.toString('base64');
        // 返回 Data URI 格式：data:<MIME-type>;base64,<data>
        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        console.error(`❌ Base64 转换失败: ${filePath}`, error.message);
        return null;
    }
}

/**
 * 混淆/压缩 JS 代码
 * (保持不变，用于压缩外部 JS 后供 HTML 嵌入)
 */
async function minifyJsCode(code) {
    // ... (保持不变)
    const result = await terser.minify(code, {
        compress: true,
        mangle: true,
        output: {
            comments: false,
        },
    });

    if (result.error) {
        console.error('❌ JS 混淆失败:', result.error);
        return null;
    }

    return result.code;
}

/**
 * 优化 CSS 代码 (替换字体引用, 去注释和压缩)
 * @param {string} css CSS 原始代码
 * @param {Map<string, string>} base64Assets 包含 {文件名: Base64 URI} 的 Map (仅包含字体文件)
 * @returns {string|null} 压缩后的代码或 null (如果失败)
 */
function minifyCssCode(css, base64Assets) {
    let modifiedCss = css;

    // 1. 替换 CSS 中的字体文件引用为 Base64 Data URI
    modifiedCss = modifiedCss.replace(CSS_URL_REGEX, (match, urlPath) => {
        // 这里的 urlPath 是相对于 CSS 文件的路径，但由于我们约定了所有文件都在 TARGET_DIR，
        // 并且 CSS 文件也在 TARGET_DIR，我们假设 urlPath 是相对于 TARGET_DIR 的根路径。
        // ******* ⚠️ 注意：如果 CSS 文件在子目录中，这里需要更复杂的路径计算！
        const fullPath = path.join(TARGET_DIR, urlPath);
        const base64Uri = base64Assets.get(fullPath);

        if (base64Uri) {
            console.log(`\t-> 嵌入字体: ${urlPath}`);
            // 替换为 Data URI
            return `url('${base64Uri}')`;
        } else {
            console.warn(`\t⚠️ 警告：找不到或处理失败字体文件: ${urlPath}。保留原引用。`);
            return match;
        }
    });

    // 2. 压缩修改后的 CSS 代码
    const result = cleanCss.minify(modifiedCss);

    if (result.errors.length > 0) {
        console.error('❌ CSS 优化失败:', result.errors);
        return null;
    }

    return result.styles;
}

/**
 * 核心合并与优化 HTML 文件
 * @param {string} filePath 文件路径 (index.html)
 * @param {Map<string, string>} externalJsCss 包含 {JS/CSS文件路径: 压缩代码} 的 Map
 * @param {string|null} faviconBase64 Favicon 的 Base64 Data URI
 */
async function embedAndMinifyHtml(filePath, externalJsCss, faviconBase64) {
    let html = await fs.readFile(filePath, 'utf8');

    // 1. 替换外部 JS 文件引用为内联代码
    html = html.replace(JS_REGEX, (match, srcPath) => {
        const fullPath = path.join(path.dirname(filePath), srcPath);
        const code = externalJsCss.get(fullPath);

        if (code) {
            console.log(`\t-> 嵌入 JS: ${srcPath}`);
            return `<script>${code}</script>`;
        } else {
            console.warn(`\t⚠️ 警告：找不到或处理失败 JS 文件: ${srcPath}。保留原引用。`);
            return match;
        }
    });

    // 2. 替换外部 CSS 文件引用为内联代码
    html = html.replace(CSS_LINK_REGEX, (match, hrefPath) => {
        const fullPath = path.join(path.dirname(filePath), hrefPath);
        const code = externalJsCss.get(fullPath);

        if (code) {
            console.log(`\t-> 嵌入 CSS: ${hrefPath}`);
            return `<style>${code}</style>`;
        } else {
            console.warn(`\t⚠️ 警告：找不到或处理失败 CSS 文件: ${hrefPath}。保留原引用。`);
            return match;
        }
    });

    // 3. 替换 Favicon 引用为 Base64 Data URI
    if (faviconBase64) {
        html = html.replace(FAVICON_REGEX, (match, tag, hrefPath) => {
            // 检查 hrefPath 是否指向我们期望的 favicon.ico
            if (path.basename(hrefPath).toLowerCase() === 'favicon.ico') {
                console.log(`\t-> 嵌入 Favicon: ${hrefPath}`);
                // 替换 href 属性的值为 Base64 Data URI
                return tag.replace(`href="${hrefPath}"`, `href="${faviconBase64}"`);
            }
            return match;
        });
    }

    // 4. 优化 HTML 本身
    const result = await htmlMinifier.minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true, // 再次压缩内联 CSS 和 JS
    });

    // 原地覆盖写入
    await fs.writeFile(filePath, result);
    console.log(`✅ HTML 合并与优化完成: ${filePath}`);
}


/**
 * 主函数：遍历目录并执行操作
 */
async function runMinification() {
    console.log(`开始对目录进行原地处理: ${TARGET_DIR} ...`);

    if (!fs.existsSync(TARGET_DIR)) {
        console.error(`错误：目标目录 ${TARGET_DIR} 不存在。请先创建该目录或修改 TARGET_DIR 配置。`);
        return;
    }

    if (!fs.existsSync(INDEX_HTML)) {
        console.error(`错误：目标文件 ${INDEX_HTML} 不存在。请确认文件结构。`);
        return;
    }

    // 用于存储所有需要 Base64 编码的资源 (字体/图标) {fullPath: Base64URI}
    const base64Assets = new Map();
    // 用于存储所有外部 JS/CSS 的压缩结果 {fullPath: minifiedCode}
    const externalJsCss = new Map();
    // 用于标记处理完成后需要删除的文件路径
    const assetsToDelete = [];

    // 1. 遍历并处理所有文件，将它们分类
    console.log('\n--- 1. 收集和处理所有外部资源 ---');

    const files = await fs.readdir(TARGET_DIR, { withFileTypes: true });

    for (const dirent of files) {
        const fullPath = path.join(TARGET_DIR, dirent.name);
        if (!dirent.isFile()) continue;

        const ext = path.extname(dirent.name).toLowerCase();

        // --- A. 字体文件 / 图标文件 (需要 Base64 编码) ---
        if (ext === '.ttf' || ext === '.woff2' || ext === '.ico') {
            const base64Uri = await convertAssetToBase64(fullPath);
            if (base64Uri) {
                console.log(`- Base64 转换完成 (待嵌入): ${dirent.name}`);
                base64Assets.set(fullPath, base64Uri);
                assetsToDelete.push(fullPath); // 标记待删除
            }
            // --- B. 独立 JS 文件 (需要压缩后嵌入 HTML) ---
        } else if (ext === '.js') {
            const originalCode = await fs.readFile(fullPath, 'utf8');
            const minifiedCode = await minifyJsCode(originalCode);
            if (minifiedCode) {
                console.log(`- JS 压缩完成 (待嵌入): ${dirent.name}`);
                externalJsCss.set(fullPath, minifiedCode);
                assetsToDelete.push(fullPath); // 标记待删除
            }
            // --- C. 独立 CSS 文件 (需要处理字体引用、压缩后嵌入 HTML) ---
        } else if (ext === '.css') {
            const originalCode = await fs.readFile(fullPath, 'utf8');
            // 注意：这里先处理字体内联，然后压缩整个 CSS
            const minifiedCode = minifyCssCode(originalCode, base64Assets);
            if (minifiedCode) {
                console.log(`- CSS 压缩完成 (待嵌入): ${dirent.name}`);
                externalJsCss.set(fullPath, minifiedCode);
                assetsToDelete.push(fullPath); // 标记待删除
            }
        }
    }

    // --- 2. 处理 index.html：嵌入代码并压缩 ---
    console.log('\n--- 2. 合并、优化 HTML 文件 ---');
    // 从 base64Assets 中获取 favicon 的 Base64 URI
    const faviconBase64 = base64Assets.get(FAVICON_ICO) || null;
    await embedAndMinifyHtml(INDEX_HTML, externalJsCss, faviconBase64);

    // --- 3. 删除已合并的文件 ---
    console.log('\n--- 3. 删除已合并的外部文件 ---');
    const deletePromises = assetsToDelete.map(p => fs.remove(p).then(() => console.log(`- 删除文件: ${path.basename(p)}`)));
    await Promise.all(deletePromises);


    console.log(`\n✨ 所有指定文件原地处理完毕！目录 ${TARGET_DIR} 已更新，实现单文件打包。`);
}

runMinification().catch(err => {
    console.error('混淆过程中发生致命错误:', err);
});