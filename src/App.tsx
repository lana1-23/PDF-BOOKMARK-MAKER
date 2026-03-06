import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Upload, FileText, Settings, Download, Plus, Trash2, ChevronRight, Loader2, CheckCircle2, AlertCircle, RefreshCw, ChevronLeft, Indent, Outdent, MousePointer2, ListChecks } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { extractTOCFromImages, ExtractedBookmark } from './services/geminiService';
import { addBookmarksToPdf } from './services/pdfService';

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [selectedTOCPages, setSelectedTOCPages] = useState<number[]>([]);
  const [bookmarks, setBookmarks] = useState<ExtractedBookmark[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [globalOffset, setGlobalOffset] = useState(0);
  const [batchOffsetValue, setBatchOffsetValue] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [previewPage, setPreviewPage] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Handle file upload
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      setFile(uploadedFile);
      const arrayBuffer = await uploadedFile.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setSelectedTOCPages([]);
      setBookmarks([]);
      setSelectedIndices([]);
      setGlobalOffset(0);
      setStatus({ type: 'idle', message: '' });
    }
  };

  // Render PDF page to canvas
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    let isCancelled = false;
    
    if (pdfDoc && canvasRef.current) {
      const renderPage = async () => {
        try {
          // Cancel any existing task before starting a new one
          if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
          }

          const page = await pdfDoc.getPage(previewPage);
          if (isCancelled) return;

          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = canvasRef.current!;
          const context = canvas.getContext('2d')!;
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const task = page.render({
            canvasContext: context,
            viewport: viewport,
          });
          renderTaskRef.current = task;
          
          await task.promise;
        } catch (error: any) {
          if (error.name === 'RenderingCancelledException') {
            // Expected
          } else {
            console.error('Render error:', error);
          }
        }
      };
      renderPage();
    }

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, previewPage]);

  const toggleTOCPage = (page: number) => {
    setSelectedTOCPages(prev => 
      prev.includes(page) ? prev.filter(p => p !== page) : [...prev, page].sort((a, b) => a - b)
    );
  };

  const handleExtract = async () => {
    if (!pdfDoc || selectedTOCPages.length === 0) return;
    
    setIsExtracting(true);
    setStatus({ type: 'idle', message: '' });

    try {
      const images: string[] = [];
      for (const pageNum of selectedTOCPages) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.5));
      }

      const extracted = await extractTOCFromImages(images);
      // Append instead of overwrite
      setBookmarks(prev => [...prev, ...extracted]);
      setSelectedIndices([]);
      // Clear selected pages after extraction to prevent accidental re-extraction
      setSelectedTOCPages([]);
      setStatus({ type: 'success', message: `成功提取并追加了 ${extracted.length} 个目录项` });
    } catch (error: any) {
      console.error(error);
      const errorMsg = error?.message || '';
      if (errorMsg.includes('Rpc failed') || errorMsg.includes('500')) {
        setStatus({ type: 'error', message: 'AI 服务响应超时，请尝试减少单次提取的页数' });
      } else {
        setStatus({ type: 'error', message: '提取失败，请重试' });
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const clearBookmarks = () => {
    if (window.confirm('确定要清空所有已提取的书签吗？')) {
      setBookmarks([]);
      setSelectedIndices([]);
    }
  };

  const handleEmbed = async () => {
    if (!file || bookmarks.length === 0) return;
    setIsEmbedding(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const finalBookmarks = bookmarks.map(b => ({
        ...b,
        page: b.page + globalOffset
      }));
      
      const modifiedPdfBytes = await addBookmarksToPdf(new Uint8Array(arrayBuffer), finalBookmarks);
      
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `[Bookmarked]_${file.name}`;
      link.click();
      URL.revokeObjectURL(url);
      
      setStatus({ type: 'success', message: 'PDF 已成功生成并下载' });
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: '嵌入失败，请重试' });
    } finally {
      setIsEmbedding(false);
    }
  };

  const updateBookmark = (index: number, field: keyof ExtractedBookmark, value: string | number) => {
    const newBookmarks = [...bookmarks];
    newBookmarks[index] = { ...newBookmarks[index], [field]: value };
    setBookmarks(newBookmarks);
  };

  const applyBatchOffset = () => {
    if (selectedIndices.length === 0) return;
    const newBookmarks = [...bookmarks];
    selectedIndices.forEach(idx => {
      newBookmarks[idx].page += batchOffsetValue;
    });
    setBookmarks(newBookmarks);
    setBatchOffsetValue(0);
  };

  const adjustLevel = (delta: number) => {
    if (selectedIndices.length === 0) return;
    const newBookmarks = [...bookmarks];
    selectedIndices.forEach(idx => {
      newBookmarks[idx].level = Math.max(0, newBookmarks[idx].level + delta);
    });
    setBookmarks(newBookmarks);
  };

  const toggleSelection = (index: number, multi: boolean) => {
    if (multi) {
      setSelectedIndices(prev => 
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    } else {
      setSelectedIndices([index]);
    }
  };

  const selectAll = () => {
    if (selectedIndices.length === bookmarks.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(bookmarks.map((_, i) => i));
    }
  };

  const removeSelected = () => {
    setBookmarks(bookmarks.filter((_, i) => !selectedIndices.includes(i)));
    setSelectedIndices([]);
  };

  const addEmptyBookmark = () => {
    const lastLevel = bookmarks.length > 0 ? bookmarks[bookmarks.length - 1].level : 0;
    setBookmarks([...bookmarks, { title: '新目录项', page: 1, level: lastLevel }]);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-black/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">PDF Bookmark Master</h1>
          </div>
          
          <div className="flex items-center gap-4">
            {status.type !== 'idle' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium",
                  status.type === 'success' ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                )}
              >
                {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {status.message}
              </motion.div>
            )}
            
            <label className="cursor-pointer bg-black text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-black/80 transition-colors flex items-center gap-2 shadow-lg shadow-black/10">
              <Upload className="w-4 h-4" />
              {file ? '更换文件' : '上传 PDF'}
              <input type="file" className="hidden" accept=".pdf" onChange={onFileChange} />
            </label>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: PDF Preview */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
            <div className="p-4 border-b border-black/5 flex items-center justify-between bg-zinc-50">
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono uppercase tracking-widest opacity-50">PDF 预览</span>
                {pdfDoc && (
                  <div className="flex items-center gap-2 bg-white border border-black/5 rounded-md px-2 py-1">
                    <button 
                      onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                      className="p-1 hover:bg-zinc-100 rounded"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1">
                      <input 
                        type="number"
                        value={previewPage}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) setPreviewPage(Math.min(numPages, Math.max(1, val)));
                        }}
                        className="text-xs font-mono w-10 text-center bg-transparent focus:outline-none border-b border-black/10 focus:border-black"
                      />
                      <span className="text-[10px] opacity-30">/ {numPages}</span>
                    </div>
                    <button 
                      onClick={() => setPreviewPage(p => Math.min(numPages, p + 1))}
                      className="p-1 hover:bg-zinc-100 rounded"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              
              {pdfDoc && (
                <button
                  onClick={() => toggleTOCPage(previewPage)}
                  className={cn(
                    "text-xs font-medium px-3 py-1.5 rounded-full transition-all flex items-center gap-2",
                    selectedTOCPages.includes(previewPage)
                      ? "bg-black text-white"
                      : "bg-white border border-black/10 hover:border-black/30"
                  )}
                >
                  {selectedTOCPages.includes(previewPage) ? "已选为目录页" : "设为目录页"}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto bg-zinc-200/50 p-8 flex justify-center items-start">
              {file ? (
                <div className="relative shadow-2xl bg-white">
                  <canvas ref={canvasRef} className="max-w-full h-auto" />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 max-w-xs">
                  <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center">
                    <Upload className="w-8 h-8 opacity-20" />
                  </div>
                  <div>
                    <h3 className="font-semibold">尚未上传文件</h3>
                    <p className="text-sm opacity-50 mt-1">上传 PDF 文件以开始提取目录并生成书签</p>
                  </div>
                </div>
              )}
            </div>

            {selectedTOCPages.length > 0 && (
              <div className="p-4 border-t border-black/5 bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <span className="text-xs font-medium opacity-50 whitespace-nowrap mr-2">已选目录页:</span>
                    {selectedTOCPages.map(p => (
                      <span key={p} className="px-2 py-1 bg-zinc-100 rounded text-[10px] font-mono border border-black/5">
                        P{p}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={handleExtract}
                    disabled={isExtracting}
                    className="ml-4 bg-black text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-black/80 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shadow-lg shadow-black/10"
                  >
                    {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    开始提取
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Bookmark Editor */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm flex flex-col h-[calc(100vh-12rem)]">
            <div className="p-4 border-b border-black/5 flex flex-col gap-4 bg-zinc-50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest opacity-50">书签管理</span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={selectAll}
                    className={cn(
                      "p-1.5 rounded-md border border-black/5 transition-colors",
                      selectedIndices.length === bookmarks.length && bookmarks.length > 0 ? "bg-black text-white" : "bg-white hover:bg-zinc-100"
                    )}
                    title="全选"
                  >
                    <ListChecks className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={addEmptyBookmark}
                    className="p-1.5 bg-white hover:bg-zinc-100 rounded-md border border-black/5 transition-colors"
                    title="添加书签"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={clearBookmarks}
                    className="p-1.5 bg-white hover:bg-rose-50 text-rose-500 rounded-md border border-black/5 transition-colors"
                    title="清空所有"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={removeSelected}
                    disabled={selectedIndices.length === 0}
                    className="p-1.5 bg-white hover:bg-rose-50 text-rose-500 rounded-md border border-black/5 transition-colors disabled:opacity-30"
                    title="删除选中"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Batch Controls */}
              <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-black/5 shadow-inner">
                <div className="flex-1 flex items-center gap-2 px-2 border-r border-black/5">
                  <Settings className="w-3.5 h-3.5 opacity-40" />
                  <span className="text-[10px] font-medium opacity-50">选中项偏移</span>
                  <input 
                    type="number" 
                    value={batchOffsetValue} 
                    onChange={(e) => setBatchOffsetValue(parseInt(e.target.value) || 0)}
                    className="w-12 text-xs font-mono focus:outline-none bg-transparent"
                  />
                  <button 
                    onClick={applyBatchOffset}
                    disabled={selectedIndices.length === 0}
                    className="text-[10px] bg-black text-white px-2 py-1 rounded-md disabled:opacity-30"
                  >
                    应用
                  </button>
                </div>
                <div className="flex items-center gap-1 px-2">
                  <button 
                    onClick={() => adjustLevel(-1)}
                    disabled={selectedIndices.length === 0}
                    className="p-1 hover:bg-zinc-100 rounded disabled:opacity-30"
                    title="减少层级"
                  >
                    <Outdent className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => adjustLevel(1)}
                    disabled={selectedIndices.length === 0}
                    className="p-1 hover:bg-zinc-100 rounded disabled:opacity-30"
                    title="增加层级"
                  >
                    <Indent className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <div className="grid grid-cols-[30px_1fr_60px_60px] px-4 py-2 border-b border-black/5 bg-zinc-50/50 sticky top-0 z-10">
                <div className="flex items-center justify-center">
                  <MousePointer2 className="w-3 h-3 opacity-30" />
                </div>
                <span className="col-header">标题 (层级)</span>
                <span className="col-header">原始页</span>
                <span className="col-header">最终页</span>
              </div>

              <AnimatePresence initial={false}>
                {bookmarks.length > 0 ? (
                  bookmarks.map((bookmark, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "data-row grid grid-cols-[30px_1fr_60px_60px] items-center px-4 py-2 group cursor-pointer",
                        selectedIndices.includes(index) ? "bg-zinc-100" : "hover:bg-zinc-50"
                      )}
                      onClick={(e) => {
                        if (e.shiftKey || e.metaKey || e.ctrlKey) {
                          toggleSelection(index, true);
                        } else {
                          toggleSelection(index, false);
                          // Jump to preview page
                          const targetPage = bookmark.page + globalOffset;
                          if (targetPage >= 1 && targetPage <= numPages) {
                            setPreviewPage(targetPage);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center justify-center">
                        <div className={cn(
                          "w-3 h-3 rounded-sm border transition-colors",
                          selectedIndices.includes(index) ? "bg-black border-black" : "border-black/20"
                        )} />
                      </div>
                      <div 
                        className="flex items-center gap-2"
                        style={{ paddingLeft: `${bookmark.level * 16}px` }}
                      >
                        {bookmark.level > 0 && <ChevronRight className="w-3 h-3 opacity-30" />}
                        <input 
                          type="text" 
                          value={bookmark.title}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateBookmark(index, 'title', e.target.value)}
                          className="text-sm font-medium bg-transparent focus:outline-none w-full"
                        />
                      </div>
                      <input 
                        type="number" 
                        value={bookmark.page}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateBookmark(index, 'page', parseInt(e.target.value) || 0)}
                        className="data-value text-xs bg-transparent focus:outline-none w-full text-center opacity-50"
                      />
                      <div className="flex items-center justify-center gap-1">
                        <div className="data-value text-xs font-bold text-black">
                          {bookmark.page + globalOffset}
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const targetPage = bookmark.page + globalOffset;
                            if (targetPage >= 1 && targetPage <= numPages) {
                              setPreviewPage(targetPage);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black hover:text-white rounded transition-all"
                          title="跳转到此页"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-30">
                    <FileText className="w-12 h-12 mb-4" />
                    <p className="text-sm font-medium">尚未提取目录</p>
                    <p className="text-xs mt-1">请在左侧预览中圈选目录页</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 border-t border-black/5 bg-zinc-50 space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 opacity-40" />
                  <span className="text-xs font-medium opacity-60">全局页码偏移 (PDF 内部校准)</span>
                </div>
                <input 
                  type="number" 
                  value={globalOffset} 
                  onChange={(e) => setGlobalOffset(parseInt(e.target.value) || 0)}
                  className="w-16 text-sm font-mono font-bold bg-white border border-black/10 rounded px-2 py-1 focus:outline-none focus:border-black"
                />
              </div>

              <button
                onClick={handleEmbed}
                disabled={isEmbedding || bookmarks.length === 0}
                className="w-full bg-black text-white py-4 rounded-2xl font-bold hover:bg-black/80 disabled:opacity-50 flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl shadow-black/10"
              >
                {isEmbedding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                一键嵌入并下载
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
