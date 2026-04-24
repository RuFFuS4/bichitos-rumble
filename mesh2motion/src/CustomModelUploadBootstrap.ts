import { Mesh2MotionEngine } from './Mesh2MotionEngine'

export class CustomModelUploadBootstrap {
  public readonly mesh2motion_engine: Mesh2MotionEngine

  constructor () {
    this.mesh2motion_engine = new Mesh2MotionEngine()
    // [BICHITOS-FORK] Expose the engine globally so BichitosRosterPicker
    // (loaded as a separate module from create.html) can flip
    // load_model_step.set_pre_rigged_mode(true) before kicking the
    // standard load flow. No engine refactor needed; one window slot.
    ;(window as unknown as { __bichitos_mm_engine?: Mesh2MotionEngine }).__bichitos_mm_engine = this.mesh2motion_engine
  }
}

// instantiate the class to setup event listeners
const app = new CustomModelUploadBootstrap()
