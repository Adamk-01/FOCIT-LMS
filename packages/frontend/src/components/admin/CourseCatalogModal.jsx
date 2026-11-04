import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Plus, Trash2, BookOpen, CheckCircle2, AlertCircle, RefreshCw, Layers, ShieldAlert } from 'lucide-react';
import { apiClient } from '../../lib/api';

const DEPARTMENTS = [
  { id: 'CSC', name: 'Computer Science' },
  { id: 'SEN', name: 'Software Engineering' },
  { id: 'CYS', name: 'Cyber Security' },
  { id: 'DSC', name: 'Data Science' },
  { id: 'IFS', name: 'Information Systems' },
  { id: 'IFT', name: 'Information Technology' },
  { id: 'LIS', name: 'Library & Info Science' },
];

export function CourseCatalogModal({ isOpen, onClose }) {
  const [courses, setCourses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [addError, setAddError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Add Course Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    code: '',
    title: '',
    departmentId: 'CSC',
    level: 100,
    units: 3,
    category: 'CORE',
    semesterNumber: 1,
    description: '',
  });

  // Delete Confirmation State
  const [courseToDelete, setCourseToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCourses = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/courses');
      const courseList = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.data) ? res.data.data : []);
      setCourses(courseList);
    } catch (err) {
      setError(err?.detail || err?.message || 'Failed to load course catalog');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCourses();
    }
  }, [isOpen]);

  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      const matchesSearch =
        searchTerm === '' ||
        c.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.department_id?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesLevel = levelFilter === 'ALL' || String(c.level) === levelFilter;
      const matchesDept = deptFilter === 'ALL' || c.department_id === deptFilter;
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && c.is_active !== false) ||
        (statusFilter === 'DEACTIVATED' && c.is_active === false);

      return matchesSearch && matchesLevel && matchesDept && matchesStatus;
    });
  }, [courses, searchTerm, levelFilter, deptFilter, statusFilter]);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAddError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await apiClient.post('/admin/courses', addForm);
      const msg = res?.data?.message || res?.data?.detail || res?.message || `Course ${addForm.code} successfully created and synced to Moodle!`;
      setSuccessMessage(msg);
      setIsAddOpen(false);
      setAddForm({
        code: '',
        title: '',
        departmentId: 'CSC',
        level: 100,
        units: 3,
        category: 'CORE',
        semesterNumber: 1,
        description: '',
      });
      fetchCourses();
    } catch (err) {
      const errMsg = err?.data?.message || err?.data?.error || err?.detail || err?.message || 'Failed to create course';
      setAddError(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!courseToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await apiClient.delete(`/admin/courses/${courseToDelete.course_id}`);
      const msg = res?.data?.message || res?.data?.detail || res?.message || `Course ${courseToDelete.code} removed successfully`;
      setSuccessMessage(msg);
      setCourseToDelete(null);
      fetchCourses();
    } catch (err) {
      const errMsg = err?.data?.message || err?.data?.error || err?.detail || err?.message || 'Failed to remove course';
      setDeleteError(errMsg);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl max-w-5xl w-full p-6 sm:p-8 shadow-2xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close academic catalog modal"
          title="Close dialog"
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="pb-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0a1142]">
                <BookOpen size={20} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-[#0a1142] font-display">
                  Academic Catalog & Course Governance
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Official accredited course registry, curriculum units & Moodle synchronization
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={fetchCourses}
              disabled={isLoading}
              className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
              title="Refresh Catalog"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setAddError(null);
                setSuccessMessage(null);
                setIsAddOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#121c5c] text-white text-xs font-bold shadow-sm transition-all"
            >
              <Plus size={16} />
              Add New Course
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 text-xs">
            <AlertCircle size={16} className="shrink-0" />
            <span className="font-medium flex-1">{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-800 text-xs">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            <span className="font-medium flex-1">{successMessage}</span>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-3 pb-4">
          <div className="sm:col-span-6 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search code, title, or department..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-xs focus:ring-2 focus:ring-[#0a1142] focus:border-transparent outline-none transition-all"
            />
          </div>

          <div className="sm:col-span-2">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-700 font-medium focus:ring-2 focus:ring-[#0a1142] outline-none"
            >
              <option value="ALL">All Academic Levels</option>
              <option value="100">100 Level</option>
              <option value="200">200 Level</option>
              <option value="300">300 Level</option>
              <option value="400">400 Level</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-700 font-medium focus:ring-2 focus:ring-[#0a1142] outline-none"
            >
              <option value="ALL">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} - {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-xs text-gray-700 font-medium focus:ring-2 focus:ring-[#0a1142] outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
        </div>

        {/* Courses Table */}
        <div className="flex-1 overflow-y-auto border border-gray-100 rounded-xl mt-2">
          {isLoading && courses.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-xs">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-[#0a1142]" />
              Loading Central Academic Catalog...
            </div>
          ) : filteredCourses.length === 0 ? (
            <div className="py-16 text-center text-gray-500 text-xs">
              No accredited courses match the selected search or filters.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 sticky top-0 z-10 border-b border-gray-200 text-gray-600 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Code & Title</th>
                  <th className="py-3 px-3">Dept</th>
                  <th className="py-3 px-3">Level / Sem</th>
                  <th className="py-3 px-3">Units</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Moodle Sync</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCourses.map((c) => (
                  <tr key={c.course_id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${c.is_active === false ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                          {c.code}
                        </span>
                        {c.is_active === false ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Deactivated
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate max-w-xs">{c.title}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-gray-700 font-semibold text-[11px]">
                        {c.department_id || 'CSC'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-700 font-medium">
                      {c.level}L • Sem {c.semester_number || 1}
                    </td>
                    <td className="py-3 px-3 font-bold text-gray-800">{c.units} Units</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.category === 'CORE'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {c.category}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {c.moodle_course_id ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                          <CheckCircle2 size={11} />
                          ID: {c.moodle_course_id}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
                          Local Only
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => { setDeleteError(null); setCourseToDelete(c); }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title={`Delete ${c.code}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Info */}
        <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 mt-3">
          <span>
            Total Accredited Courses: <strong className="text-gray-800">{filteredCourses.length}</strong> of{' '}
            {courses.length}
            {courses.some((c) => c.is_active === false) && (
              <span className="ml-2 text-rose-600 font-medium">
                ({courses.filter((c) => c.is_active === false).length} deactivated)
              </span>
            )}
          </span>
          <span className="text-[11px] text-gray-400">
            Changes automatically propagate to FOCIT database & Moodle LMS
          </span>
        </div>
      </div>

      {/* --- ADD COURSE SUB-MODAL --- */}
      {isAddOpen && (
        <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#0a1142] flex items-center justify-center">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0a1142]">Add New Course</h3>
                  <p className="text-[11px] text-gray-500">Provision into Academic Catalog & Moodle</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                aria-label="Close add course dialog"
                title="Close dialog"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {addError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-red-700 text-xs">
                <AlertCircle size={15} className="shrink-0" />
                <span className="font-medium flex-1">{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCourse} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Course Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CSC 412"
                    value={addForm.code}
                    onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Department *</label>
                  <select
                    value={addForm.departmentId}
                    onChange={(e) => setAddForm({ ...addForm, departmentId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.id} - {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Course Full Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Artificial Intelligence & Neural Networks"
                  value={addForm.title}
                  onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Level *</label>
                  <select
                    value={addForm.level}
                    onChange={(e) => setAddForm({ ...addForm, level: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  >
                    <option value={100}>100 Level</option>
                    <option value={200}>200 Level</option>
                    <option value={300}>300 Level</option>
                    <option value={400}>400 Level</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Semester *</label>
                  <select
                    value={addForm.semesterNumber}
                    onChange={(e) => setAddForm({ ...addForm, semesterNumber: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  >
                    <option value={1}>Semester 1 (Rain / Harmattan)</option>
                    <option value={2}>Semester 2 (Omega / Spring)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Units *</label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    required
                    value={addForm.units}
                    onChange={(e) => setAddForm({ ...addForm, units: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Category *</label>
                  <select
                    value={addForm.category}
                    onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                  >
                    <option value="CORE">CORE</option>
                    <option value="ELECTIVE">ELECTIVE</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Course curriculum overview..."
                  value={addForm.description}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-[#0a1142]"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0a1142] hover:bg-[#121c5c] text-white font-bold inline-flex items-center gap-2"
                >
                  {isSubmitting && <RefreshCw size={14} className="animate-spin" />}
                  {isSubmitting ? 'Creating Course...' : 'Provision Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- DELETE CONFIRMATION MODAL --- */}
      {courseToDelete && (
        <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4 mx-auto border border-red-100">
              <ShieldAlert size={24} />
            </div>
            <h3 className="text-base font-bold text-center text-gray-900">
              Remove Course from Catalog?
            </h3>
            <p className="text-xs text-gray-500 text-center mt-2 leading-relaxed">
              Are you sure you want to remove{' '}
              <strong className="text-gray-900">{courseToDelete.code} - {courseToDelete.title}</strong>?
            </p>
            <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-800">
              <strong>Notice:</strong> If students have existing active enrollments, the system will safely deactivate and hide the course to preserve academic ledger integrity.
            </div>

            {deleteError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-red-700 text-xs text-left">
                <AlertCircle size={15} className="shrink-0" />
                <span className="font-medium flex-1">{deleteError}</span>
              </div>
            )}

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setCourseToDelete(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-bold text-xs hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteCourse}
                disabled={isDeleting}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs inline-flex items-center gap-2 shadow-sm"
              >
                {isDeleting && <RefreshCw size={14} className="animate-spin" />}
                {isDeleting ? 'Deleting...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default CourseCatalogModal;
