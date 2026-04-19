import { UI } from './UI'
import { type SceneEnvironmentManager } from './SceneEnvironmentManager'

export class SettingsDropdownManager {
  private readonly ui: UI = UI.getInstance()
  private initialized: boolean = false
  private is_open: boolean = false
  private readonly scene_environment?: SceneEnvironmentManager

  constructor (scene_environment?: SceneEnvironmentManager) {
    this.scene_environment = scene_environment
    this.initialize()
  }

  private initialize (): void {
    if (this.initialized) {
      return
    }

    const toggle_button = this.ui.dom_settings_toggle_button
    const dropdown_container = this.ui.dom_settings_dropdown_container
    const dropdown_content = this.ui.dom_settings_dropdown_content

    if (toggle_button === null || dropdown_container === null || dropdown_content === null) {
      return
    }

    this.initialized = true

    toggle_button.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      this.toggle_dropdown()
    })

    document.addEventListener('click', (event: MouseEvent) => {
      if (!this.is_open) {
        return
      }

      const target = event.target as Node | null
      if (target === null) {
        return
      }

      if (!dropdown_container.contains(target)) {
        this.close_dropdown()
      }
    })

    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.close_dropdown()
      }
    })

    this.initialize_light_intensity_setting()
  }

  private initialize_light_intensity_setting (): void {
    if (this.scene_environment === undefined) {
      return
    }

    const light_intensity_input = this.ui.dom_light_intensity_input
    if (light_intensity_input === null) {
      return
    }

    light_intensity_input.value = this.scene_environment.get_light_intensity_multiplier().toFixed(2)

    light_intensity_input.addEventListener('input', () => {
      const slider_value = Number(light_intensity_input.value)
      if (!Number.isFinite(slider_value)) {
        return
      }

      this.scene_environment?.set_light_intensity_multiplier(slider_value)
    })
  }

  private open_dropdown (): void {
    const toggle_button = this.ui.dom_settings_toggle_button
    const dropdown_content = this.ui.dom_settings_dropdown_content

    if (toggle_button === null || dropdown_content === null) {
      return
    }

    this.is_open = true
    dropdown_content.hidden = false
    toggle_button.setAttribute('aria-expanded', 'true')
  }

  private close_dropdown (): void {
    const toggle_button = this.ui.dom_settings_toggle_button
    const dropdown_content = this.ui.dom_settings_dropdown_content

    if (toggle_button === null || dropdown_content === null) {
      return
    }

    this.is_open = false
    dropdown_content.hidden = true
    toggle_button.setAttribute('aria-expanded', 'false')
  }

  private toggle_dropdown (): void {
    if (this.is_open) {
      this.close_dropdown()
    } else {
      this.open_dropdown()
    }
  }
}