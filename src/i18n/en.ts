export const en: Record<string, string> = {
    // Settings
    'settings.title': 'Image Manager Settings',
    'settings.language': 'Language',
    'settings.languageDesc': 'Display language for the plugin',
    'settings.general': 'General',
    'settings.imageDirectory': 'Image directory',
    'settings.imageDirectoryDesc': 'Default directory for storing images (relative to vault root)',
    'settings.referenceFormat': 'Reference format',
    'settings.referenceFormatDesc': 'Default format for inserting image references',
    'settings.referenceFormat.wiki': 'Obsidian Wiki: ![[image.png]]',
    'settings.referenceFormat.markdown': 'Standard Markdown: ![alt](image.png)',
    'settings.compression': 'Compression',
    'settings.autoCompress': 'Auto compress',
    'settings.autoCompressDesc': 'Automatically compress images when inserting',
    'settings.compressQuality': 'Compress quality',
    'settings.compressQualityDesc': 'Compression quality (1-100)',
    'settings.gallery': 'Gallery',
    'settings.thumbnailSize': 'Thumbnail size',
    'settings.thumbnailSizeDesc': 'Thumbnail size in pixels',
    'settings.imageHosting': 'Image Hosting',
    'settings.uploadPathTemplate': 'Upload path template',
    'settings.uploadPathTemplateDesc':
        'Template for upload path. Variables: {year}, {month}, {day}, {filename}, {hash}, {ext}, {timestamp}',
    'settings.autoReplaceAfterUpload': 'Auto replace after upload',
    'settings.autoReplaceAfterUploadDesc':
        'Automatically replace local references with hosting URLs after uploading',

    // Commands
    'command.browseImages': 'Browse images',
    'command.compressImage': 'Compress current image',
    'command.convertReference': 'Convert reference format (current note)',
    'command.convertReferenceVault': 'Convert reference format (entire vault)',
    'command.uploadToHosting': 'Upload image to hosting',
    'command.batchUpload': 'Batch upload all images',
    'command.findOrphans': 'Find orphan images',
    'command.renameImage': 'Rename image (update references)',
    'command.migrateImages': 'Migrate images to hosting',

    // Ribbon
    'ribbon.tooltip': 'Image Manager',

    // Notices
    'notice.notImplemented': 'not yet implemented',
    'notice.noActiveEditor': 'No active editor. Please open a note first.',
    'notice.imageInserted': 'Image inserted',
    'notice.compressSuccess': 'Image compressed, saved {saved}%',
    'notice.compressNoGain': 'Image is already well-compressed, no changes made',
    'notice.compressFailed': 'Image compression failed',
    'notice.noRefsToConvert': 'No image references found to convert',
    'notice.convertSuccess': 'Converted {count} reference(s) in current note',
    'notice.convertVaultSuccess': 'Converted {count} reference(s) across {files} file(s)',
    'notice.noHostingConfig': 'No image hosting configured. Please add one in settings.',
    'notice.uploading': 'Uploading image...',
    'notice.uploadSuccess': 'Upload successful! URL copied to clipboard.',
    'notice.uploadFailed': 'Upload failed: {error}',
    'notice.noImagesToUpload': 'No images found to upload.',
    'notice.batchUploadStart': 'Starting batch upload of {count} images...',
    'notice.batchUploadProgress': 'Uploading: {done}/{total} - {current}',
    'notice.batchUploadDone': 'Batch upload complete: {success}/{total} succeeded.',
    'notice.renameSuccess': 'Renamed "{old}" to "{new}", updated {notes} note(s).',
    'notice.renameFailed': 'Rename failed: {error}',

    // Image Browser Modal
    'modal.imageBrowser.title': 'Image Browser',
    'modal.imageBrowser.searchPlaceholder': 'Search images...',
    'modal.imageBrowser.sortName': 'Name',
    'modal.imageBrowser.sortSize': 'Size',
    'modal.imageBrowser.sortModified': 'Modified',
    'modal.imageBrowser.sortCreated': 'Created',
    'modal.imageBrowser.showing': 'Showing {count} of {total} images',
    'modal.imageBrowser.noImages': 'No images found in vault',
    'modal.imageBrowser.insertTooltip': 'Click to insert',

    // Confirm Dialog
    'modal.confirm.ok': 'Confirm',
    'modal.confirm.cancel': 'Cancel',

    // Orphan Images Modal
    'modal.orphan.title': 'Orphan Images',
    'modal.orphan.scanning': 'Scanning for orphan images...',
    'modal.orphan.status': 'Found {orphan} orphan(s) out of {total} images ({referenced} referenced)',
    'modal.orphan.noOrphans': 'No orphan images found. All images are referenced.',
    'modal.orphan.selectAll': 'Select All',
    'modal.orphan.selectNone': 'Select None',
    'modal.orphan.totalSize': 'Total: {size}',
    'modal.orphan.deleteSelected': 'Delete Selected',
    'modal.orphan.noSelection': 'No images selected.',
    'modal.orphan.deleteConfirmTitle': 'Delete Orphan Images',
    'modal.orphan.deleteConfirmMsg': 'Are you sure you want to delete {count} orphan image(s)? This cannot be undone.',
    'modal.orphan.deleted': 'Deleted {count} orphan image(s).',

    // Rename Modal
    'modal.rename.title': 'Rename Image',
    'modal.rename.desc': 'Rename "{name}" and update all references across your vault.',
    'modal.rename.confirm': 'Rename',
};
