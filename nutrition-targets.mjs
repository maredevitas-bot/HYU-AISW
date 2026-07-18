export const KDRI_SOURCE_URL = 'https://www.kns.or.kr/fileroom/fileroom_view.asp?BoardID=Kdr&idx=167'

export const genderOptions = {
  female: { label: '여학생' },
  male: { label: '남학생' },
}

export const ageGroupOptions = {
  '12-14': { label: '12-14세' },
  '15-18': { label: '15-18세' },
}

export const kdriProfiles = {
  male: {
    '12-14': { dayKcal: 2500, protein: 60, calcium: 950, iron: 11 },
    '15-18': { dayKcal: 2700, protein: 65, calcium: 800, iron: 11 },
  },
  female: {
    '12-14': { dayKcal: 2000, protein: 55, calcium: 850, iron: 13 },
    '15-18': { dayKcal: 2000, protein: 55, calcium: 700, iron: 12 },
  },
}

export function makeDailyTarget(gender, ageGroup) {
  const profile = kdriProfiles[gender]?.[ageGroup] ?? kdriProfiles.female['15-18']
  const dayKcal = profile.dayKcal

  return {
    dayKcal,
    kcal: dayKcal,
    carbs: Math.round((dayKcal * 0.575) / 4),
    protein: profile.protein,
    fat: Math.round((dayKcal * 0.225) / 9),
    sodium: 2300,
    calcium: profile.calcium,
    iron: profile.iron,
  }
}

export function makeLunchTarget(gender, ageGroup) {
  const daily = makeDailyTarget(gender, ageGroup)
  const ratio = 0.34

  return {
    dayKcal: daily.dayKcal,
    kcal: Math.round(daily.kcal * ratio),
    carbs: Math.round(daily.carbs * ratio),
    protein: Math.round(daily.protein * ratio),
    fat: Math.round(daily.fat * ratio),
    sodium: Math.round(daily.sodium * ratio),
    calcium: Math.round(daily.calcium * ratio),
    iron: Number((daily.iron * ratio).toFixed(1)),
  }
}
