/** 支持的图片 MIME 类型映射 */
export const IMAGE_MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    avif: 'image/avif',
};

/** 视图类型常量 */
export const VIEW_TYPE_IMAGE_GALLERY = 'image-manager-gallery';
export const VIEW_TYPE_UPLOAD_QUEUE = 'image-manager-upload-queue';

/** 正则：标准 Markdown 图片引用 */
export const MD_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 正则：Obsidian Wiki 图片引用 */
export const WIKI_IMAGE_REGEX = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** 上传路径模板变量 */
export const PATH_TEMPLATE_VARS = [
    '{year}',
    '{month}',
    '{day}',
    '{filename}',
    '{hash}',
    '{ext}',
    '{timestamp}',
] as const;
