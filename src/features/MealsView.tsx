import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, BookOpen, Check, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, Plus, RefreshCw, Tag, Utensils,
} from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { Modal } from '../App'
import { createFoodIntakeLog, createMealDefinition, getFoodIntakeLogs, getMealDefinitions } from '../lib/api'
import type { FoodIntakeLog, MealDefinition, MealType, Patient, Session } from '../lib/types'

export default function MealsView({
  session,
  patient,
  canManage = true,
  locale = 'en',
  notify,
}: {
  session: Session
  patient: Patient
  canManage?: boolean
  locale?: string
  notify?: (message: string) => void
}) {
  const fa = locale === 'fa'
  const [meals, setMeals] = useState<MealDefinition[]>([])
  const [intakeLogs, setIntakeLogs] = useState<FoodIntakeLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | MealType>('ALL')
  const [expandedRecipeId, setExpandedRecipeId] = useState<number | null>(null)

  // Modals
  const [showLogModal, setShowLogModal] = useState(false)
  const [selectedMealForLog, setSelectedMealForLog] = useState<MealDefinition | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  const copy = fa ? {
    eyebrow: 'برنامه تغذیه و دستورهای پخت',
    title: 'غذا و تغذیه',
    description: 'برنامه غذایی بیمار، دستور پخت بالینی، رژیم غذایی و ثبت میزان مصرف.',
    logIntake: 'ثبت مصرف غذا',
    addMeal: 'تعریف وعده غذایی',
    all: 'همه وعده‌ها',
    breakfast: 'صبحانه',
    lunch: 'ناهار',
    dinner: 'شام',
    snack: 'میان‌وعده',
    hydration: 'آب و نوشیدنی',
    plannedMeals: 'وعده‌ها و دستورهای پخت فعال',
    noPlanned: 'هنوز برنامه غذایی برای این بیمار تعریف نشده است.',
    noPlannedDesc: 'یک وعده غذایی با دستور پخت و نکات رژیمی ثبت کنید.',
    ingredients: 'مواد اولیه:',
    recipeInstructions: 'دستور پخت و نکات آماده‌سازی:',
    quickLog: 'ثبت مصرف این وعده',
    hideRecipe: 'بستن دستور پخت',
    viewRecipe: 'مشاهده دستور پخت',
    recentIntake: 'گزارش مصرف غذای امروز',
    noIntake: 'هنوز گزارشی برای مصرف غذای امروز ثبت نشده است.',
    consumed: 'مصرف شد',
    notes: 'یادداشت:',
    recordedBy: 'ثبت توسط',
    scheduledFor: 'زمان پیشنهادی:',
    retry: 'تلاش دوباره',
    loadError: 'اطلاعات تغذیه بارگذاری نشد.',
  } : {
    eyebrow: 'CLINICAL NUTRITION & RECIPES',
    title: 'Food & Meals',
    description: 'Structured dietary care plan, cooking instructions, recipes, and intake tracking.',
    logIntake: 'Log food intake',
    addMeal: 'Add meal / recipe',
    all: 'All meals',
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snacks',
    hydration: 'Hydration',
    plannedMeals: 'Planned Meals & Recipes',
    noPlanned: 'No meal recipes defined for this patient yet.',
    noPlannedDesc: 'Add clinical meal definitions with ingredients and cooking instructions.',
    ingredients: 'Ingredients:',
    recipeInstructions: 'Recipe & cooking instructions:',
    quickLog: 'Log intake for this meal',
    hideRecipe: 'Hide recipe',
    viewRecipe: 'View recipe & instructions',
    recentIntake: "Today's Intake Log",
    noIntake: 'No food intake logs recorded today.',
    consumed: 'consumed',
    notes: 'Notes:',
    recordedBy: 'Recorded by',
    scheduledFor: 'Target time:',
    retry: 'Try again',
    loadError: 'Meal records could not be loaded.',
  }

  const mealTypeLabels: Record<MealType, string> = {
    BREAKFAST: copy.breakfast,
    LUNCH: copy.lunch,
    DINNER: copy.dinner,
    SNACK: copy.snack,
    HYDRATION: copy.hydration,
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [mealList, logs] = await Promise.all([
        getMealDefinitions(session.token, patient.id),
        getFoodIntakeLogs(session.token, patient.id),
      ])
      setMeals(mealList)
      setIntakeLogs(logs)
    } catch {
      setError(copy.loadError)
    } finally {
      setLoading(false)
    }
  }, [copy.loadError, patient.id, session.token])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredMeals = useMemo(() => {
    if (typeFilter === 'ALL') return meals
    return meals.filter((m) => m.meal_type === typeFilter)
  }, [meals, typeFilter])

  const handleOpenLogModal = (meal?: MealDefinition) => {
    setSelectedMealForLog(meal || null)
    setShowLogModal(true)
  }

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        action={
          <div className="med-actions">
            <button className="secondary-button" onClick={() => handleOpenLogModal()}>
              <Utensils size={18} /> {copy.logIntake}
            </button>
            {canManage && (
              <button className="primary-button" onClick={() => setShowAddModal(true)}>
                <Plus size={18} /> {copy.addMeal}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="workspace-notice">
          <AlertCircle />
          {error}
          <button className="text-button" onClick={loadData}>
            {copy.retry}
          </button>
        </div>
      )}

      {/* Meal type filter tabs */}
      <div className="audit-filters" role="group" aria-label={copy.title}>
        <button className={typeFilter === 'ALL' ? 'active' : ''} onClick={() => setTypeFilter('ALL')}>
          {copy.all}
        </button>
        {(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'HYDRATION'] as MealType[]).map((t) => (
          <button key={t} className={typeFilter === t ? 'active' : ''} onClick={() => setTypeFilter(t)}>
            {mealTypeLabels[t]}
          </button>
        ))}
      </div>

      <div className="dashboard-grid">
        {/* Left Column: Planned Meals & Cooking Instructions */}
        <section className="main-card meals-column">
          <div className="subsection-heading">
            <div>
              <h3>{copy.plannedMeals}</h3>
              <p>{filteredMeals.length} {fa ? 'مورد' : 'recipes configured'}</p>
            </div>
            <button className="text-button" onClick={loadData} aria-label="Refresh">
              <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            </button>
          </div>

          {loading && !meals.length && (
            <div className="empty-care compact">
              <RefreshCw className="spinning" />
              <strong>{fa ? 'در حال بارگذاری غذاها…' : 'Loading meals…'}</strong>
            </div>
          )}

          {!loading && !filteredMeals.length && (
            <div className="empty-care compact">
              <Utensils />
              <strong>{copy.noPlanned}</strong>
              <p>{copy.noPlannedDesc}</p>
              {canManage && (
                <button className="secondary-button" onClick={() => setShowAddModal(true)}>
                  <Plus size={16} /> {copy.addMeal}
                </button>
              )}
            </div>
          )}

          <div className="meal-cards-list">
            {filteredMeals.map((meal) => {
              const isExpanded = expandedRecipeId === meal.id
              return (
                <article className="meal-card" key={meal.id}>
                  <div className="meal-card-header">
                    <div className="meal-card-title-group">
                      <span className={`badge-pill badge-${meal.meal_type.toLowerCase()}`}>
                        {mealTypeLabels[meal.meal_type] || meal.meal_type}
                      </span>
                      {meal.target_time && (
                        <span className="meal-time">
                          <Clock3 size={14} /> {meal.target_time.slice(0, 5)}
                        </span>
                      )}
                      <h4>{meal.name}</h4>
                    </div>
                    <button
                      className="complete-button compact-btn"
                      onClick={() => handleOpenLogModal(meal)}
                      title={copy.quickLog}
                    >
                      <Check size={16} /> {copy.logIntake}
                    </button>
                  </div>

                  {meal.dietary_tags?.length > 0 && (
                    <div className="dietary-tags-row">
                      {meal.dietary_tags.map((tag) => (
                        <span className="tag-chip" key={tag}>
                          <Tag size={12} /> {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {meal.ingredients?.length > 0 && (
                    <div className="meal-ingredients">
                      <strong>{copy.ingredients}</strong> {meal.ingredients.join(', ')}
                    </div>
                  )}

                  {meal.instructions && (
                    <div className="meal-recipe-container">
                      <button
                        type="button"
                        className="text-button recipe-toggle-btn"
                        onClick={() => setExpandedRecipeId(isExpanded ? null : meal.id)}
                      >
                        <BookOpen size={15} />
                        <span>{isExpanded ? copy.hideRecipe : copy.viewRecipe}</span>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>

                      {isExpanded && (
                        <div className="recipe-instructions-box">
                          <span className="eyebrow">{copy.recipeInstructions}</span>
                          <p>{meal.instructions}</p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        {/* Right Column: Intake Tracking Log */}
        <section className="main-card intake-column">
          <div className="subsection-heading">
            <div>
              <h3>{copy.recentIntake}</h3>
              <p>{intakeLogs.length} {fa ? 'رکورد ثبت شده' : 'entries recorded'}</p>
            </div>
            <button className="primary-button compact-btn" onClick={() => handleOpenLogModal()}>
              <Plus size={16} /> {copy.logIntake}
            </button>
          </div>

          {!intakeLogs.length && (
            <div className="empty-care compact">
              <CheckCircle2 />
              <strong>{copy.noIntake}</strong>
              <p>{fa ? 'پس از صرف وعده، درصد مصرف و یادداشت بیمار را ثبت کنید.' : 'Log patient meals, percentage eaten, and hydration.'}</p>
            </div>
          )}

          <div className="intake-logs-list">
            {intakeLogs.map((log) => {
              const portionColor = log.portion_consumed >= 75 ? 'green' : log.portion_consumed >= 50 ? 'yellow' : 'red'
              return (
                <article className="intake-log-item" key={log.id}>
                  <div className="intake-log-head">
                    <div className="intake-meta">
                      <span className={`portion-indicator portion-${portionColor}`}>
                        {log.portion_consumed}%
                      </span>
                      <strong>{log.meal_name}</strong>
                      <span className="meal-type-tag">
                        {mealTypeLabels[log.meal_type] || log.meal_type}
                      </span>
                    </div>
                    <time dir="ltr">
                      {new Date(log.recorded_at).toLocaleTimeString(fa ? 'fa-IR-u-ca-persian' : undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>

                  {log.notes && (
                    <p className="intake-notes">
                      <em>{log.notes}</em>
                    </p>
                  )}

                  <div className="intake-footer">
                    <small>
                      {copy.recordedBy}: <b>{log.recorded_by_name || (fa ? 'کاربر' : 'User')}</b>
                    </small>
                    <small>
                      {new Date(log.recorded_at).toLocaleDateString(fa ? 'fa-IR-u-ca-persian' : undefined)}
                    </small>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>

      {/* Record Intake Modal */}
      {showLogModal && (
        <LogIntakeModal
          session={session}
          patient={patient}
          meals={meals}
          initialMeal={selectedMealForLog}
          onClose={() => {
            setShowLogModal(false)
            setSelectedMealForLog(null)
          }}
          onSaved={() => {
            setShowLogModal(false)
            setSelectedMealForLog(null)
            loadData()
            notify?.(fa ? 'مصرف وعده غذایی با موفقیت ثبت شد.' : 'Meal intake recorded.')
          }}
          locale={locale}
        />
      )}

      {/* Add Meal / Recipe Modal */}
      {showAddModal && (
        <AddMealModal
          session={session}
          patient={patient}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false)
            loadData()
            notify?.(fa ? 'وعده غذایی و دستور پخت جدید ثبت شد.' : 'New meal definition created.')
          }}
          locale={locale}
        />
      )}
    </>
  )
}

function LogIntakeModal({
  session,
  patient,
  meals,
  initialMeal,
  onClose,
  onSaved,
  locale,
}: {
  session: Session
  patient: Patient
  meals: MealDefinition[]
  initialMeal: MealDefinition | null
  onClose: () => void
  onSaved: () => void
  locale: string
}) {
  const fa = locale === 'fa'
  const [selectedMealId, setSelectedMealId] = useState<string>(initialMeal ? String(initialMeal.id) : '')
  const [mealName, setMealName] = useState(initialMeal ? initialMeal.name : '')
  const [mealType, setMealType] = useState<MealType>(initialMeal ? initialMeal.meal_type : 'LUNCH')
  const [portion, setPortion] = useState<number>(100)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSelectMeal = (mealIdStr: string) => {
    setSelectedMealId(mealIdStr)
    const found = meals.find((m) => String(m.id) === mealIdStr)
    if (found) {
      setMealName(found.name)
      setMealType(found.meal_type)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!mealName.trim()) {
      setError(fa ? 'نام وعده غذایی الزامی است.' : 'Meal name is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await createFoodIntakeLog(session.token, {
        patient: patient.id,
        meal_definition: selectedMealId ? Number(selectedMealId) : null,
        meal_type: mealType,
        meal_name: mealName.trim(),
        portion_consumed: portion,
        notes: notes.trim(),
        recorded_at: new Date().toISOString(),
        client_reference: crypto.randomUUID(),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : fa ? 'ثبت مصرف غذا انجام نشد.' : 'Could not log intake.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} locale={locale} label={fa ? 'ثبت مصرف غذای بیمار' : 'Log Food Intake'}>
      <span className="eyebrow">{fa ? 'ثبت تغذیه بالینی' : 'CLINICAL INTAKE RECORD'}</span>
      <h2>{fa ? 'ثبت مصرف غذای بیمار' : 'Log Food Intake'}</h2>
      <p className="modal-intro">
        {fa
          ? `ثبت میزان مصرف غذا و مشاهدات برای ${patient.full_name}`
          : `Record portion consumed and observations for ${patient.full_name}`}
      </p>

      <form className="task-form" onSubmit={submit}>
        {meals.length > 0 && (
          <label>
            {fa ? 'انتخاب از وعده‌های تعریف‌شده (اختیاری)' : 'Select from planned recipes (optional)'}
            <select value={selectedMealId} onChange={(e) => handleSelectMeal(e.target.value)}>
              <option value="">{fa ? '-- وعده سفارشی / خارج از برنامه --' : '-- Custom or unplanned food --'}</option>
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.meal_type})
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {fa ? 'نام غذا یا نوشیدنی' : 'Meal / item name'}
          <input
            required
            value={mealName}
            onChange={(e) => setMealName(e.target.value)}
            placeholder={fa ? 'مانند: سوپ مرغ و سبزیجات' : 'e.g. Chicken vegetable soup'}
          />
        </label>

        <label>
          {fa ? 'نوع وعده' : 'Meal type'}
          <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
            <option value="BREAKFAST">{fa ? 'صبحانه' : 'Breakfast'}</option>
            <option value="LUNCH">{fa ? 'ناهار' : 'Lunch'}</option>
            <option value="DINNER">{fa ? 'شام' : 'Dinner'}</option>
            <option value="SNACK">{fa ? 'میان‌وعده' : 'Snack'}</option>
            <option value="HYDRATION">{fa ? 'آب و مایعات' : 'Hydration'}</option>
          </select>
        </label>

        <label>
          {fa ? `میزان مصرف: ${portion}٪` : `Portion consumed: ${portion}%`}
          <div className="portion-chips" role="group" aria-label="Portion presets">
            {[0, 25, 50, 75, 100].map((p) => (
              <button
                type="button"
                key={p}
                className={portion === p ? 'active' : ''}
                onClick={() => setPortion(p)}
              >
                {p}%
              </button>
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={portion}
            onChange={(e) => setPortion(Number(e.target.value))}
          />
        </label>

        <label>
          {fa ? 'یادداشت و مشاهده‌ها (اختیاری)' : 'Observations & notes (optional)'}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={fa ? 'اشتها، میزان مصرف مایعات، واکنش بیمار یا باقی‌مانده غذا' : 'Appetite, fluid intake, swallowing difficulty, or leftovers'}
          />
        </label>

        {error && <div className="login-error"><AlertCircle />{error}</div>}

        <button className="primary-button" disabled={saving}>
          {saving ? (fa ? 'در حال ثبت…' : 'Saving…') : (fa ? 'ثبت گزارش مصرف' : 'Save intake log')}
        </button>
      </form>
    </Modal>
  )
}

function AddMealModal({
  session,
  patient,
  onClose,
  onSaved,
  locale,
}: {
  session: Session
  patient: Patient
  onClose: () => void
  onSaved: () => void
  locale: string
}) {
  const fa = locale === 'fa'
  const [name, setName] = useState('')
  const [mealType, setMealType] = useState<MealType>('LUNCH')
  const [targetTime, setTargetTime] = useState('12:30')
  const [instructions, setInstructions] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(fa ? 'نام وعده غذایی الزامی است.' : 'Meal name is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const ingredients = ingredientsText
        .split(/[,،\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const dietaryTags = tagsText
        .split(/[,،\n]/)
        .map((s) => s.trim())
        .filter(Boolean)

      await createMealDefinition(session.token, {
        patient: patient.id,
        name: name.trim(),
        meal_type: mealType,
        target_time: targetTime ? `${targetTime}:00` : null,
        instructions: instructions.trim(),
        ingredients,
        dietary_tags: dietaryTags,
        active: true,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : fa ? 'وعده غذایی ثبت نشد.' : 'Could not save meal.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} locale={locale} label={fa ? 'تعریف وعده و دستور پخت' : 'Add Meal & Recipe'}>
      <span className="eyebrow">{fa ? 'برنامه تغذیه بالینی' : 'NEW DIETARY RECIPE'}</span>
      <h2>{fa ? 'تعریف وعده و دستور پخت' : 'Add Meal & Recipe'}</h2>
      <p className="modal-intro">
        {fa ? `تعریف وعده غذایی و دستور پخت برای ${patient.full_name}` : `Configure recipe instructions and meal timing for ${patient.full_name}`}
      </p>

      <form className="task-form" onSubmit={submit}>
        <label>
          {fa ? 'نام غذا' : 'Meal / recipe name'}
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fa ? 'مانند: سوپ جو و سبزیجات کم‌نمک' : 'e.g., Low-sodium vegetable barley soup'}
          />
        </label>

        <div className="form-row">
          <label>
            {fa ? 'نوع وعده' : 'Meal type'}
            <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
              <option value="BREAKFAST">{fa ? 'صبحانه' : 'Breakfast'}</option>
              <option value="LUNCH">{fa ? 'ناهار' : 'Lunch'}</option>
              <option value="DINNER">{fa ? 'شام' : 'Dinner'}</option>
              <option value="SNACK">{fa ? 'میان‌وعده' : 'Snack'}</option>
              <option value="HYDRATION">{fa ? 'آب و مایعات' : 'Hydration'}</option>
            </select>
          </label>

          <label>
            {fa ? 'زمان پیشنهادی سرو' : 'Target serving time'}
            <input
              type="time"
              dir="ltr"
              value={targetTime}
              onChange={(e) => setTargetTime(e.target.value)}
            />
          </label>
        </div>

        <label>
          {fa ? 'برچسب‌های رژیمی (با کاما جدا کنید)' : 'Dietary tags (comma separated)'}
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder={fa ? 'کم‌نمک، نرم، پرفیبر، مناسب دیابت' : 'Low Sodium, Soft Food, High Fiber, Diabetic Friendly'}
          />
        </label>

        <label>
          {fa ? 'مواد اولیه (با کاما یا خط جدید جدا کنید)' : 'Ingredients (comma or newline separated)'}
          <textarea
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={fa ? 'جو پرک، هویج پخته، جعفری تازه، سینه مرغ آب‌پز' : 'Rolled oats, carrots, parsley, boiled chicken breast'}
          />
        </label>

        <label>
          {fa ? 'دستور پخت و نکات آماده‌سازی' : 'Recipe & preparation instructions'}
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={fa ? 'روش پخت، میزان حرارت، بافت غذا و نکات ایمنی سرو' : 'Cooking steps, heat level, food texture, and temperature precautions'}
          />
        </label>

        {error && <div className="login-error"><AlertCircle />{error}</div>}

        <button className="primary-button" disabled={saving}>
          {saving ? (fa ? 'در حال ثبت…' : 'Saving…') : (fa ? 'ذخیره وعده غذایی' : 'Save meal definition')}
        </button>
      </form>
    </Modal>
  )
}
