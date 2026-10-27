import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Batch Course Inspection Dialog
 *
 * Implements:
 * 1. Native HTML <dialog> element per WHATWG HTML Living Standard Section 4.11.4
 * 2. Course units and category listing for the inspected student registration batch
 * 3. WCAG minimum 44px touch targets on dismiss actions
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function BatchInspectionDialog({ batch, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (batch) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [batch]);

  if (!batch) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="inspection-modal-title"
      className="m-auto rounded-2xl p-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm max-w-xl w-full shadow-2xl border-0 overflow-hidden"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-h-[85vh] flex flex-col border border-gray-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
        <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50 dark:bg-slate-800/60">
          <div>
            <h3 id="inspection-modal-title" className="text-base font-bold text-[#0a1142] dark:text-[#ffb81c]">
              Course Matrix: {batch.student_name}
            </h3>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              {batch.matric_number} • {batch.total_units} Total Units
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-w-[44px] min-h-[44px] p-2 rounded-xl text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors touch-manipulation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800 flex-1">
          {Array.isArray(batch.items) && batch.items.length > 0 ? (
            batch.items.map((item, idx) => (
              <div key={idx} className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#0a1142] dark:text-slate-100 text-sm">{item.code}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300">
                      {item.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">{item.title}</p>
                </div>
                <span className="text-xs font-bold text-gray-800 dark:text-slate-200">{item.units} Units</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-500 dark:text-slate-400 py-4 text-center">
              No courses listed in this registration batch.
            </p>
          )}
        </div>

        <div className="p-4 bg-gray-50 dark:bg-slate-800/60 border-t border-gray-100 dark:border-slate-800 text-right">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2.5 bg-[#0a1142] dark:bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-[#16258f] dark:hover:bg-indigo-700 transition-colors touch-manipulation"
          >
            Close Inspection
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default BatchInspectionDialog;
