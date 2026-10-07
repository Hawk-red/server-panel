// Запуск: cd backend && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyAlert } from './alertClassifier.js'

const cats = (t: string) => classifyAlert(t).categories.join(',')

test('общая ракета без типа → missile', () => {
  assert.equal(cats('Ракета на Київ!'), 'missile')
  assert.equal(classifyAlert('Ракета на Київ!').isMissile, true)
  assert.equal(cats('🚀Ракети в р-ні Носівки (Чернігівщина) у напрямку Київщини.'), 'missile')
})
test('опечатка «алістика» → ballistic', () => {
  assert.equal(cats('алістика на Київ'), 'ballistic')
  assert.equal(cats('🚀Повторно балістичні ракети в бік Києва!'), 'ballistic') // не дублируется как missile
})
test('отбой — игнор', () => {
  const c = classifyAlert('📢 Відбій загрози застосування  балістичного озброєння.')
  assert.equal(c.ignored, true)
  assert.equal(c.ignoreReason, 'clear')
  assert.equal(c.isMissile, false)
  assert.equal(classifyAlert('Зберігається загроза застосування балістичного озброєння, до оголошення відбою перебувайте в укриттях').ignored, true)
  assert.equal(classifyAlert('Отбой воздушной тревоги').ignored, true)
})
test('длинный пост про День Повітряних Сил — игнор', () => {
  const t = '✈️ Євгеній Хмара:\n\nСьогодні — День Повітряних Сил Збройних Сил України.\n\n' + 'З перших днів повномасштабної війни росія хотіла вільно використовувати українське небо для ударів: балістика, крилаті ракети, шахеди. '.repeat(4)
  const c = classifyAlert(t)
  assert.equal(c.ignored, true)
  assert.equal(c.ignoreReason, 'news')
  assert.equal(classifyAlert('Указом Президента посмертно присвоєно звання Героя України').ignored, true)
})
test('дроны', () => {
  assert.equal(cats('🛵 Реактивний БпЛА з півночі на Київ'), 'drone')
  assert.equal(cats('🏍 Реактивні БпЛА на Київщині: на Васильків'), 'drone')
  assert.equal(cats('🚀Баражуючий боєприпас "Бандероль" на півночі Київщини'), 'drone')
  assert.equal(classifyAlert('БпЛА на Бровари').isMissile, false)
})
test('МіГ-31К — hypersonic, вылет носителя не ракетный удар', () => {
  const c = classifyAlert('⚠Увага! 🚀Ракетна небезпека по всій території України! 🛫Зафіксовано зліт МіГ-31К!')
  assert.deepEqual(c.categories, ['hypersonic'])
  assert.equal(c.takeoff, true)
  assert.equal(c.isMissile, false)
  assert.deepEqual(classifyAlert('Кинджал на Київ').categories, ['hypersonic'])
  assert.equal(classifyAlert('Кинджал на Київ').isMissile, true)
})
test('стратегическая авиация → aviation', () => {
  const c = classifyAlert('Зафіксовано зліт 3 бортів Ту-160')
  assert.deepEqual(c.categories, ['aviation'])
  assert.equal(c.takeoff, true)
  assert.equal(c.isMissile, false)
  assert.equal(cats('✈ Близько 3.00 зафіксовано зліт 6 бортів Ту-95 з аеродрому «Оленегорськ»!'), 'aviation')
  assert.equal(cats('Зліт стратегічної авіації з Енгельса'), 'aviation')
})
test('вылет Ту-95 с оговоркой про крылатые — не ракетный удар', () => {
  const c = classifyAlert('✈ Близько 3.00 зафіксовано зліт 6 бортів Ту-95!\n\nУ разі здійснення пусків крилатих ракет, входження їх у повітряний простір очікується після 06:00.')
  assert.equal(c.isMissile, false)
  assert.equal(c.takeoff, true)
  assert.deepEqual(c.categories, ['cruise', 'aviation'])
})
test('крылатые и смешанные', () => {
  assert.equal(cats('Крилаті ракети Калібр з Чорного моря'), 'cruise')
  assert.equal(cats('Крилата ракета та БпЛА на Київ'), 'cruise,drone')
  assert.equal(cats('Х-101 курсом на Київ'), 'cruise')
})
test('ложные срабатывания', () => {
  assert.equal(cats('Ракетне паливо подорожчало'), 'other')
  assert.equal(cats('Ракетна небезпека по всій Україні'), 'other')
  assert.equal(cats('Курс на Київ.'), 'other')
  assert.equal(classifyAlert('На Бровари.').isMissile, false)
})
