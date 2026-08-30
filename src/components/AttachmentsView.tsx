import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Folder,
  FolderPlus,
  File,
  FileText,
  Download,
  Trash2,
  Edit,
  ChevronRight,
  ChevronDown,
  Upload,
  X,
  CheckCircle2,
} from "lucide-react";
import { GlassCard } from "@/components/GlassCard";
import { useAttachmentsStore, type Attachment, type AttachmentFolder } from "@/stores/attachments";
import { useI18n } from "@/i18n";

interface AttachmentsViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AttachmentsView({ isOpen, onClose }: AttachmentsViewProps) {
  const { t } = useI18n();
  const attachments = useAttachmentsStore((s) => s.attachments);
  const folders = useAttachmentsStore((s) => s.folders);
  const selectedFolderId = useAttachmentsStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useAttachmentsStore((s) => s.setSelectedFolderId);
  const addFolder = useAttachmentsStore((s) => s.addFolder);
  const renameFolder = useAttachmentsStore((s) => s.renameFolder);
  const deleteFolder = useAttachmentsStore((s) => s.deleteFolder);
  const addAttachment = useAttachmentsStore((s) => s.addAttachment);
  const renameAttachment = useAttachmentsStore((s) => s.renameAttachment);
  const deleteAttachment = useAttachmentsStore((s) => s.deleteAttachment);

  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingAttachment, setRenamingAttachment] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const isImage = (mimeType: string) => mimeType.startsWith("image/");

  const folderTree = useMemo(() => {
    const buildTree = (parentId: string | null): AttachmentFolder[] => {
      return folders
        .filter((f) => f.parentId === parentId)
        .map((f) => ({ ...f, children: buildTree(f.id) }));
    };
    return buildTree(null);
  }, [folders]);

  const currentAttachments = useMemo(() => {
    return attachments.filter((a) => a.folderId === selectedFolderId);
  }, [attachments, selectedFolderId]);

  const currentFolder = folders.find((f) => f.id === selectedFolderId);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Ограничение 300 МБ
    if (file.size > 300 * 1024 * 1024) {
      alert(t("attachmentTooLarge"));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      addAttachment(file.name, selectedFolderId, base64, file.type, file.size);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const downloadAttachment = (attachment: Attachment) => {
    setDownloadingId(attachment.id);
    const link = document.createElement("a");
    link.href = `data:${attachment.mimeType};base64,${attachment.data}`;
    link.download = attachment.name;
    link.click();
    // Показываем анимацию 1.5 секунды
    setTimeout(() => setDownloadingId(null), 1500);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingFolder(id);
    setRenameValue(currentName);
  };

  const finishRenameFolder = (id: string) => {
    if (renameValue.trim()) {
      renameFolder(id, renameValue.trim());
    }
    setRenamingFolder(null);
    setRenameValue("");
  };

  const startRenameAttachment = (id: string, currentName: string) => {
    setRenamingAttachment(id);
    setRenameValue(currentName);
  };

  const finishRenameAttachment = (id: string) => {
    if (renameValue.trim()) {
      renameAttachment(id, renameValue.trim());
    }
    setRenamingAttachment(null);
    setRenameValue("");
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderFolder = (folder: AttachmentFolder & { children?: AttachmentFolder[] }, depth = 0) => {
    const hasChildren = (folder.children?.length || 0) > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${
            isSelected ? "soft-accent" : "hover:bg-[var(--btn-ghost-bg)]"
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => {
            setSelectedFolderId(folder.id);
            if (hasChildren) toggleFolder(folder.id);
          }}
        >
          {hasChildren ? (
            <button onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }} className="p-0.5">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <div className="w-5" />
          )}
          <Folder className="w-4 h-4" />
          {renamingFolder === folder.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => finishRenameFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRenameFolder(folder.id);
                if (e.key === "Escape") setRenamingFolder(null);
              }}
              className="field rounded px-2 py-1 text-sm flex-1"
            />
          ) : (
            <span className="flex-1 truncate">{folder.name}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); startRename(folder.id, folder.name); }}
            className="icon-btn !p-1 opacity-0 group-hover:opacity-100"
          >
            <Edit className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteFolder(folder.id); }}
            className="icon-btn !p-1 opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        {isExpanded && folder.children?.map((c) => renderFolder(c, depth + 1))}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50"
    >
      <div className="overlay absolute inset-0" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="absolute inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
      >
        <GlassCard className="w-full max-w-4xl max-h-[85vh] flex flex-col pointer-events-auto">
          <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "var(--divider)" }}>
            <div className="flex items-center gap-3">
              <div className="icon-badge w-10 h-10">
                <File className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold t1">{t("attachmentsTitle")}</h2>
            </div>
            <button onClick={onClose} className="icon-btn">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Folders */}
            <div className="w-64 flex-shrink-0 border-r overflow-y-auto" style={{ borderColor: "var(--divider)" }}>
              <div className="p-3 space-y-1">
                <button
                  onClick={() => setSelectedFolderId(null)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    selectedFolderId === null ? "soft-accent" : "hover:bg-[var(--btn-ghost-bg)]"
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  <span>{t("attachmentsRoot")}</span>
                </button>

                {creatingFolder ? (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Folder className="w-4 h-4" />
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          addFolder(newFolderName, selectedFolderId);
                          setNewFolderName("");
                          setCreatingFolder(false);
                        }
                        if (e.key === "Escape") setCreatingFolder(false);
                      }}
                      onBlur={() => setCreatingFolder(false)}
                      placeholder={t("folderName")}
                      className="field rounded px-2 py-1 text-sm flex-1"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setCreatingFolder(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--btn-ghost-bg)]"
                  >
                    <FolderPlus className="w-4 h-4" />
                    <span>{t("newFolder")}</span>
                  </button>
                )}

                {folderTree.map((f) => renderFolder(f))}
              </div>
            </div>

            {/* Files */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "var(--divider)" }}>
                <div>
                  <h3 className="font-medium t1">
                    {currentFolder ? currentFolder.name : t("attachmentsRoot")}
                  </h3>
                  <p className="text-xs t3">{currentAttachments.length} {t("attachmentsCount")}</p>
                </div>
                <label className="btn-primary px-3 py-2 text-sm cursor-pointer flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  {t("uploadFile")}
                  <input type="file" className="hidden" onChange={handleFileSelect} />
                </label>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {currentAttachments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 t3">
                    <File className="w-12 h-12 mb-4 opacity-30" />
                    <p>{t("attachmentsEmpty")}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {currentAttachments.map((attachment) => (
                      <GlassCard key={attachment.id} className="p-4 group relative">
                        <div className="flex items-start justify-between mb-3">
                          {isImage(attachment.mimeType) ? (
                            <button
                              onClick={() => setPreviewAttachment(attachment)}
                              className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                            >
                              <img
                                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                                alt={attachment.name}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="icon-badge w-10 h-10">
                              <FileText className="w-5 h-5" />
                            </div>
                          )}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => downloadAttachment(attachment)}
                              className="icon-btn"
                              title={t("download")}
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => startRenameAttachment(attachment.id, attachment.name)}
                              className="icon-btn"
                              title={t("edit")}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteAttachment(attachment.id)}
                              className="icon-btn danger"
                              title={t("delete")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {downloadingId === attachment.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="absolute inset-0 flex items-center justify-center rounded-lg z-10"
                            style={{ background: "rgba(0,0,0,0.6)" }}
                          >
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: "spring", damping: 15 }}
                              className="w-12 h-12 rounded-full flex items-center justify-center"
                              style={{ background: "var(--accent)" }}
                            >
                              <CheckCircle2 className="w-6 h-6 text-white" />
                            </motion.div>
                          </motion.div>
                        )}
                        {renamingAttachment === attachment.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => finishRenameAttachment(attachment.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") finishRenameAttachment(attachment.id);
                              if (e.key === "Escape") setRenamingAttachment(null);
                            }}
                            className="field rounded px-2 py-1 text-sm w-full"
                          />
                        ) : (
                          <p className="font-medium text-sm t1 truncate">{attachment.name}</p>
                        )}
                        <p className="text-xs t3 mt-1">{formatSize(attachment.size)}</p>
                      </GlassCard>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {previewAttachment && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50"
        >
          <div className="overlay absolute inset-0" onClick={() => setPreviewAttachment(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center z-[60] p-8 pointer-events-none"
          >
            <div className="relative max-w-full max-h-full pointer-events-auto">
              <button
                onClick={() => setPreviewAttachment(null)}
                className="absolute -top-10 right-0 icon-btn text-white"
              >
                <X className="w-6 h-6" />
              </button>
              <img
                src={`data:${previewAttachment.mimeType};base64,${previewAttachment.data}`}
                alt={previewAttachment.name}
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
                style={{ boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}
              />
              <div className="mt-2 text-center">
                <p className="text-sm text-white font-medium">{previewAttachment.name}</p>
                <p className="text-xs text-gray-300">{formatSize(previewAttachment.size)}</p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}
