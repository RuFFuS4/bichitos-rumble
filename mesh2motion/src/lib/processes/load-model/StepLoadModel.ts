import { UI } from '../../UI.ts'
import { ModelZipLoader } from './ModelZipLoader.ts'
import { CustomFBXLoader, type FBXResults } from './CustomFBXLoader.ts'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig } from '../../RigConfig.ts'

import { Scene } from 'three/src/scenes/Scene.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import { MathUtils } from 'three/src/math/MathUtils.js'
import { BufferGeometry, Group, MeshPhongMaterial, Object3DEventMap, SkinnedMesh, type Material, type Object3D, type Skeleton } from 'three'
import { ModalDialog } from '../../ModalDialog.ts'
import { ModelCleanupUtility } from './ModelCleanupUtility.ts'
import { PlatformUtils } from '../../PlatformUtils.ts'

// [BICHITOS-FORK] Pre-rigged GLBs (Tripo Animate exports) ship a 39-bone
// humanoid skeleton already bound to the mesh. Detection helper lives in
// the Bichitos integration layer.
import { isTripoRig } from '../../../BichitosTripoRetargeter.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepLoadModel extends EventTarget {
  private readonly gltf_loader = new GLTFLoader()
  private readonly custom_fbx_loader: CustomFBXLoader = new CustomFBXLoader()
  private readonly ui: UI = UI.getInstance()
  private original_model_data: Scene | Group = new Scene()
  private final_mesh_data: Scene = new Scene() // mesh data used when creating the skinned mesh

  // model data used for retargeting process. Only used during retargeting processes
  private final_retargetable_model_data: Scene = new Scene()
  private debug_model_loading: boolean = false

  private model_display_name: string = 'Imported Model'

  // there can be multiple objects in a model, so store them in a list
  private readonly geometry_list: BufferGeometry[] = []
  private readonly material_list: Material[] = []

  private _added_event_listeners: boolean = false

  // this can happen when images are not loading. this
  // will mess up model and need to just replace the entire material
  private mesh_has_broken_material: boolean = false

  // controls whether to preserve all objects (bones, lights, etc.) or strip to meshes only
  private preserve_skinned_mesh: boolean = false

  // [BICHITOS-FORK] When true, treat the loaded GLB as already containing
  // a usable skeleton + skin weights. Skips the Fit Skeleton, Edit Skeleton,
  // and Bind/Weight steps and jumps straight to the Animations Listing
  // using the pre-existing rig. Set by `BichitosRosterPicker` before the
  // load button fires.
  private pre_rigged_mode: boolean = false

  // [BICHITOS-FORK] When pre_rigged_mode triggers and the loaded GLB
  // really does carry a Tripo-style rig, we cache the discovered
  // SkinnedMesh instances + their shared Skeleton so the engine can hand
  // them to StepWeightSkin without ever running the skinning algorithm.
  // We also stash the entire loaded scene root — the engine moves its
  // whole hierarchy (ParentNode → Armature → bones + SkinnedMesh) into
  // a wrapper Group so rotate / scale transforms propagate to both
  // mesh AND bones (critical: rotating the mesh alone leaves bones in
  // place and skinning snaps vertices back).
  private pre_rigged_skinned_meshes: SkinnedMesh[] = []
  private pre_rigged_skeleton: Skeleton | null = null
  private pre_rigged_root: Scene | null = null

  // for debugging, let's count these to help us test performance things better
  vertex_count = 0
  triangle_count = 0
  objects_count = 0

  private original_geometry_positions: Float32Array[] = []

  /**
   * Skinned mesh data that will be used for retargeting
   * @returns Loaded Skinned mesh data that will be used for retargeting
   */
  public get_final_retargetable_model_data (): Scene {
    return this.final_retargetable_model_data
  }

  // function that goes through all our geometry data and calculates how many triangles we have
  private calculate_mesh_metrics (buffer_geometry: BufferGeometry[]): void {
    let triangle_count = 0
    let vertex_count = 0

    // calculate all the loaded mesh data
    buffer_geometry.forEach((geometry) => {
      triangle_count += geometry.attributes.position.count / 3
      vertex_count += geometry.attributes.position.count
    })

    this.triangle_count = triangle_count
    this.vertex_count = vertex_count
    this.objects_count = buffer_geometry.length
  }

  private calculate_geometry_and_materials (scene_to_analyze: Scene): void {
    // clear geometry and material list in case we run this again
    // this empties the array in place, and doesn't need to create a new array
    this.geometry_list.length = 0
    this.material_list.length = 0

    scene_to_analyze.traverse((child: Object3D) => {
      if (child.type === 'Mesh') {
        const geometry_to_add: BufferGeometry = this.build_geometry_list_from_mesh(child as Mesh)
        this.geometry_list.push(geometry_to_add)

        // material is broken somehow, so just use a normal material to help communicate this
        if (this.mesh_has_broken_material) {
          const new_material: MeshPhongMaterial = new MeshPhongMaterial()
          new_material.color.set(0x00aaee)
          this.material_list.push(new_material)
          return
        }

        // handle multiple materials (array) or single material
        if (Array.isArray((child as Mesh).material)) {
          // clone each material in the array and preserve array structure
          const materials = (child as Mesh).material as Material[]
          const cloned_materials = materials.map(mat => mat.clone())
          this.material_list.push(cloned_materials as any)
        } else {
          // single material case
          const new_material: Material = ((child as Mesh).material as Material).clone()
          this.material_list.push(new_material)
        }
      }
    })
  }

  /**
   * bring in a mesh object, extract geometry data and return only attributes we need
   * Removes Interleaved buffer attributes and converted to normal buffer attributes
   * @param mesh object
   * @returns Geometry data with Buffer Attributes
   */
  private build_geometry_list_from_mesh (child: Mesh): BufferGeometry {
    // handle normal data buffer attribute data structure
    const geometry_to_add: BufferGeometry = child.geometry.clone()
    geometry_to_add.name = child.name

    // the geometry data might be stored as Interleaved buffer,  if it is
    // we need to convert the data to a reular BufferGeometry for processing later
    // this way we can normalize processing later
    if (child.geometry.attributes.position.isInterleavedBufferAttribute) {
      // console.log('reading interleaved geometry for child mesh. Converting', child.geometry)
      geometry_to_add.setAttribute('position', child.geometry.attributes.position.clone())

      // [BICHITOS-FORK] normal/uv are not guaranteed to exist on every GLB.
      // Tripo3D exports ship POSITION + TEXCOORD_0 only (no NORMAL). Without
      // these guards the lab threw `Cannot read properties of undefined
      // (reading 'clone')` silently on critter load ("click bichito = no-op"
      // symptom). computeVertexNormals() fills the gap on the cloned
      // low-poly geometry when the source lacks normals.
      if (child.geometry.attributes.normal !== undefined) {
        geometry_to_add.setAttribute('normal', child.geometry.attributes.normal.clone())
      }
      if (child.geometry.attributes.uv !== undefined) {
        geometry_to_add.setAttribute('uv', child.geometry.attributes.uv.clone())
      }

      // set uv2 if it exists
      if (child.geometry.attributes.uv2 !== undefined) {
        geometry_to_add.setAttribute('uv2', child.geometry.attributes.uv2.clone())
      }

      // remove skinIndex and skinWeight if they exist
      if (child.geometry.attributes.skinIndex !== undefined) {
        geometry_to_add.deleteAttribute('skinIndex')
      }
      if (child.geometry.attributes.skinWeight !== undefined) {
        geometry_to_add.deleteAttribute('skinWeight')
      }
    }

    // [BICHITOS-FORK] if the source had no normals at all (not just when
    // interleaved), recompute them here so every downstream step (weight
    // paint, skinning, preview shading) has a valid attribute to read.
    if (geometry_to_add.attributes.normal === undefined) {
      geometry_to_add.computeVertexNormals()
    }

    return geometry_to_add
  }

  public begin (): void {
    if (this.ui.dom_current_step_index !== null) {
      this.ui.dom_current_step_index.innerHTML = '1'
    }

    if (this.ui.dom_current_step_element !== null) {
      this.ui.dom_current_step_element.innerHTML = 'Load Model'
    }

    if (this.ui.dom_load_model_tools !== null) {
      this.ui.dom_load_model_tools.style.display = 'flex'
    }

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }
  }

  public add_event_listeners (): void {
    // Populate the model reference dropdown from the central rig config
    const model_select = document.querySelector<HTMLSelectElement>('#model-selection')
    if (model_select !== null) {
      RigConfig.populate_model_select(model_select)
    }

    if (this.ui.dom_upload_model_button !== null) {
      // handle file upload
      this.ui.dom_upload_model_button.addEventListener('change', (event: Event) => {
        const file = event.target.files[0]
        const file_extension: string = this.get_file_extension(file.name)

        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = () => {
          console.log('File reader loaded', reader)
          this.load_model_file(reader.result, file_extension)
        }
      })

      // iOS has a weird issue with accepted file extensions, so we need to just
      // accept everything for that platform
      if (PlatformUtils.isIOS()) {
        this.ui.dom_upload_model_button.setAttribute('accept', '*/*')
      }
    }

    if (this.ui.dom_load_model_debug_checkbox !== null) {
      this.ui.dom_load_model_debug_checkbox.addEventListener('change', (event: Event) => {
        const debug_mode = event.target.checked
        this.debug_model_loading = debug_mode
      })
    }

    if (this.ui.dom_load_model_button !== null) {
      this.ui.dom_load_model_button.addEventListener('click', () => {
        // get currently selected option out of the model-selection drop-down
        const model_selection = document.querySelector('#model-selection')

        if (model_selection !== null) {
          const file_name = model_selection.options[model_selection.selectedIndex].value
          const file_extension: string = this.get_file_extension(file_name)
          this.load_model_file(file_name, file_extension)
        }
      })
    }
  }

  private get_file_extension (file_path: string): string {
    const file_name: string | undefined = file_path.split('/').pop() // remove the directory path

    if (file_name === undefined) {
      console.error('Critical Error: Undefined file extension when loading model')
      return 'UNDEFINED'
    }

    const file_extension: string | undefined = file_name?.split('.').pop() // just get last part of the file name

    if (file_extension === undefined) {
      console.error('Critical Error: File does not have a "." symbol in the name')
      return 'UNDEFINED'
    }

    return file_extension
  }

  public clear_loaded_model_data (): void {
    this.original_model_data = new Scene()
    this.final_mesh_data = new Scene()
    this.geometry_list.length = 0
    this.material_list.length = 0
    this.original_geometry_positions = []
    this.vertex_count = 0
    this.triangle_count = 0
    this.objects_count = 0
    this.mesh_has_broken_material = false
    this.preserve_skinned_mesh = false
    // [BICHITOS-FORK] reset pre-rigged data so the next load starts clean
    this.pre_rigged_mode = false
    this.pre_rigged_skinned_meshes = []
    this.pre_rigged_skeleton = null
    this.pre_rigged_root = null
  }

  public reset_model_position (): void {
    let i = 0
    this.final_mesh_data.traverse((obj: Object3D) => {
      if (obj.type === 'Mesh') {
        const mesh = obj as Mesh
        const attr = mesh.geometry.attributes.position
        const original = this.original_geometry_positions[i++]
        if (original !== undefined) {
          ;(attr.array as Float32Array).set(original)
          attr.needsUpdate = true
          mesh.geometry.computeBoundingBox()
          mesh.geometry.computeBoundingSphere()
        }
      }
    })
    this.final_mesh_data.position.set(0, 0, 0)
  }

  /**
   *
   * @param preserve
   */
  public set_preserve_skinned_mesh (preserve: boolean): void {
    this.preserve_skinned_mesh = preserve
  }

  // [BICHITOS-FORK] ----------------------------------------------------
  /** Toggle pre-rigged mode. Call before triggering `#load-model-button`
   *  so the next `process_loaded_scene` knows to keep the skeleton. */
  public set_pre_rigged_mode (enabled: boolean): void {
    this.pre_rigged_mode = enabled
    if (!enabled) {
      this.pre_rigged_skinned_meshes = []
      this.pre_rigged_skeleton = null
    }
  }

  public is_pre_rigged_mode (): boolean {
    return this.pre_rigged_mode
  }

  /** Read the SkinnedMesh instances captured during the last pre-rigged
   *  load. Empty if either the load wasn't pre-rigged or no skinned mesh
   *  was actually found in the GLB. */
  public get_pre_rigged_skinned_meshes (): SkinnedMesh[] {
    return this.pre_rigged_skinned_meshes
  }

  public get_pre_rigged_skeleton (): Skeleton | null {
    return this.pre_rigged_skeleton
  }

  /** The entire loaded GLB scene root (Tripo's ParentNode → Armature →
   *  bones + SkinnedMesh). The engine moves its children into the
   *  PreRiggedWrapper Group so rotate/scale transforms propagate. */
  public get_pre_rigged_root (): Scene | null {
    return this.pre_rigged_root
  }

  /** True when detection cached a valid pre-rigged skeleton on the
   *  most recent load. Used by the "Use existing rig" button in Edit
   *  Skeleton to decide whether to show itself. */
  public has_pre_rigged_data (): boolean {
    return this.pre_rigged_skinned_meshes.length > 0 && this.pre_rigged_skeleton !== null
  }

  /** Fire the `modelLoadedPreRigged` event against this step. Used by
   *  the UI when the user clicks "Use existing rig" in Edit Skeleton —
   *  the engine listens for the event and calls
   *  `activate_pre_rigged_pipeline()`. */
  public trigger_pre_rigged_activation (): boolean {
    if (!this.has_pre_rigged_data()) {
      console.warn('[BICHITOS-FORK] trigger_pre_rigged_activation: no cached data to activate')
      return false
    }
    // Promote the cached scene into final_mesh_data for downstream
    // accessors (the engine wrapper move operates on it).
    if (this.pre_rigged_root) this.final_mesh_data = this.pre_rigged_root as Scene
    this.dispatchEvent(new CustomEvent('modelLoadedPreRigged'))
    return true
  }
  // [BICHITOS-FORK] end ------------------------------------------------

  public load_model_file (model_file_path: string | ArrayBuffer | null, file_extension: string): void {
    if (file_extension === 'fbx') {
      this.load_fbx_file(model_file_path)
    } else if (file_extension === 'glb') {
      this.gltf_loader.load(model_file_path as string, (gltf) => {
        const loaded_scene: Scene = gltf.scene
        this.process_loaded_scene(loaded_scene)
      })
    } else if (file_extension === 'zip') {
      console.log('ZIP file can contain GLTF+BIN model data')
      this.handle_zip_file(model_file_path)
    } else {
      console.error('Unsupported file format to load. Only acccepts FBX, (ZIP)GLTF+BIN, GLB:', model_file_path)
    }
  }

  private load_fbx_file (model_file_path: string | ArrayBuffer | null): void {
    if (typeof model_file_path !== 'string') {
      console.warn('something weird happened and FBX is being loaded that is not a filepath for a string:', model_file_path)
      return
    }

    // console.log('Loading FBX model:', model_file_path)
    this.custom_fbx_loader.loadFBX(model_file_path).then((results: FBXResults) => {
      console.log('loaded the FBX file', results)
      this.mesh_has_broken_material = results.is_missing_dependencies
      const loaded_scene: Scene = new Scene()

      // TODO: add the processed, cleaned up data instead of the fbx_scene directly
      loaded_scene.add(results.fbx_scene)

      this.process_loaded_scene(loaded_scene)
    }).catch((error) => {
      console.warn('some type of error', error)
    })
  }

  /**
   * Handles loading a model from a ZIP file with GLTF data
   * supporting both data URLs and ArrayBuffer input.
   */
  private handle_zip_file (model_file_path: string | ArrayBuffer | null): void {
    const zip_loader = new ModelZipLoader()

    // internal async function that loads the ZIP from an ArrayBuffer
    const handle_zip = async (buffer: ArrayBuffer): Promise<void> => {
      try {
        const scene = await zip_loader.loadModelFromZip(buffer)
        console.log('Model loaded from ZIP:', scene)
        this.process_loaded_scene(scene)
      } catch (err) {
        // if no GLTF file found, or other error, show dialog
        console.error('Failed to load model from ZIP:', err)
        new ModalDialog('Failed to load model from ZIP: ', err?.message || err).show()
      }
    }

    // load in the zip and send the array buffer data to the loader
    if (typeof model_file_path === 'string' && model_file_path.startsWith('data:')) {
      fetch(model_file_path)
        .then(async res => await res.arrayBuffer()) // convert to ArrayBuffer for processing
        .then(buffer => handle_zip(buffer).catch((err) => {
          const msg = (err && typeof err === 'object' && 'message' in err) ? err.message : String(err)
          console.error('Failed to load model from ZIP:', err)
          new ModalDialog('Failed to load model from ZIP: ', msg).show()
        }))
        .catch((err) => {
          const msg = (err && typeof err === 'object' && 'message' in err) ? err.message : String(err)
          console.error('Failed to fetch ZIP data:', err)
          new ModalDialog('Failed to fetch ZIP data: ', msg).show()
        })
    } else {
      // ZIP file is corrupted??
      const msg = 'ZIP file data is not in a supported format'
      console.error(msg)
      new ModalDialog('ZIP file error decompressing: ', msg).show()
    }
  }

  private process_loaded_scene (loaded_scene: Scene): void {
    // [BICHITOS-FORK] ALWAYS detect + cache a Tripo-style pre-rigged
    // skeleton if the loaded GLB carries one. The detection is silent —
    // it just stashes references so a later button click ("Use model's
    // existing rig" in Edit Skeleton) can jump to AnimationsListing
    // without reloading. The normal MM flow (Fit / Edit / Bind) runs
    // uninterrupted on the parallel stripped copy.
    //
    // If `pre_rigged_mode` was set explicitly (e.g. by a button that
    // wants to short-circuit the flow), we also dispatch the activation
    // event here, which drives the engine into pre-rigged mode.
    const detected = this.try_capture_pre_rigged_scene(loaded_scene, /*dispatchEvent*/ this.pre_rigged_mode)
    if (this.pre_rigged_mode && detected) return
    if (this.pre_rigged_mode && !detected) {
      console.warn(
        '[BICHITOS-FORK] pre_rigged_mode requested but no SkinnedMesh/Tripo rig detected in loaded GLB. Falling back to normal rigging flow.'
      )
      this.pre_rigged_mode = false
    }

    if (this.preserve_skinned_mesh) {
      this.original_model_data = loaded_scene
    } else {
      this.original_model_data = loaded_scene.clone()
      this.original_model_data.name = 'Cloned Scene'
    }

    this.original_model_data.traverse((child) => {
      child.castShadow = true
    })

    // strip out things differently if we need to preserve skinned meshes or regular meshes
    let clean_scene_with_only_models: Scene
    if (this.preserve_skinned_mesh) {
      // need to be careful with cleaning up and skeleton data. it can break the hierarchy
      // and mess up the skinned mesh and exports. So for now, just keep everything
      clean_scene_with_only_models = this.original_model_data
    } else {
      clean_scene_with_only_models = ModelCleanupUtility.strip_out_all_unecessary_model_data(this.original_model_data, this.model_display_name, this.debug_model_loading)
    }

    // if there are no valid mesh, or skinned mesh, show error dialog
    if (clean_scene_with_only_models.children.length === 0) {
      if (this.preserve_skinned_mesh) {
        new ModalDialog('Error loading model', 'No SkinnedMesh found in model file for retargeting').show()
      } else {
        new ModalDialog('Error loading model', 'No Mesh found in model file').show()
      }
      return
    }

    // if we are doing retargeting, our work ends here for loading the model
    // assign the final retargetable model data to the cleaned scene with skinned meshes
    // any scaling or further processing can be donw as part of the retargeting process
    if (this.preserve_skinned_mesh) {
      this.final_retargetable_model_data = clean_scene_with_only_models
      this.dispatchEvent(new CustomEvent('modelLoadedForRetargeting'))
      return
    }

    // loop through each child in scene and reset rotation
    // if we don't the skinning process doesn't take rotation into account
    // and creates odd results
    clean_scene_with_only_models.traverse((child) => {
      child.rotation.set(0, 0, 0)
      child.scale.set(1, 1, 1)
      child.updateMatrix() // helps re-calculate bounding box for scaling later
      child.updateMatrixWorld() // helps re-calculate bounding box for scaling later
    })

    // Some objects come in very large, which makes it harder to work with
    // scale everything down to a max height. mutate the clean scene object
    ModelCleanupUtility.scale_model_on_import_if_extreme(clean_scene_with_only_models)

    // preserved skinned meshes shouldn't be breaking apart mesh data
    // breaking apart skinned meshes converts it to a regular mesh which we don't want.
    this.calculate_geometry_and_materials(clean_scene_with_only_models)
    this.calculate_mesh_metrics(this.geometry_list) // this needs to happen after calculate_geometry_and_materials
    console.log(`Vertex count:${this.vertex_count}    Triangle Count:${this.triangle_count} Object Count:${this.objects_count} `)

    // assign the final cleaned up model to the original model data
    this.final_mesh_data = this.model_meshes()

    // snapshot vertex positions so we can reset later
    this.original_geometry_positions = []
    this.final_mesh_data.traverse((obj: Object3D) => {
      if (obj.type === 'Mesh') {
        const positions = (obj as Mesh).geometry.attributes.position.array as Float32Array
        this.original_geometry_positions.push(new Float32Array(positions))
      }
    })

    console.log('final mesh data should be prepared at this point', this.final_mesh_data)

    this.dispatchEvent(new CustomEvent('modelLoaded'))
  }

  // [BICHITOS-FORK] -----------------------------------------------------
  /** Attempts to capture the pre-rigged data from a freshly-loaded scene.
   *  Returns true when a usable SkinnedMesh + Tripo skeleton was found
   *  and cached. Only dispatches `modelLoadedPreRigged` when `dispatch`
   *  is true — detection is otherwise silent, for the "opt-in from
   *  Edit Skeleton" flow where the normal MM rigging happens on the
   *  stripped copy and the user later activates pre-rigged manually.
   *  Returns false when the scene didn't carry what we need. */
  private try_capture_pre_rigged_scene (loaded_scene: Scene, dispatch: boolean = true): boolean {
    const skinned: SkinnedMesh[] = []
    let skeleton: Skeleton | null = null

    loaded_scene.traverse((child) => {
      const sm = child as SkinnedMesh
      if (sm?.isSkinnedMesh && sm.skeleton) {
        skinned.push(sm)
        // All Tripo critters share a single skeleton across mesh parts;
        // grab the first one we find.
        if (!skeleton) skeleton = sm.skeleton
      }
    })

    if (!skinned.length || !skeleton) return false
    if (!isTripoRig(skeleton)) {
      console.warn(
        '[BICHITOS-FORK] SkinnedMesh found but skeleton is not the Tripo rig — bone count or signature bones missing. Pre-rigged mode aborted.'
      )
      return false
    }

    // Keep the original scene as the canonical model data so downstream
    // accessors (model_meshes, calculate_geometry_and_materials) still
    // work without surprise — but we also publish the SkinnedMesh array
    // for the engine to hand off directly to StepWeightSkin.
    this.original_model_data = loaded_scene
    this.original_model_data.name = 'PreRigged Scene'
    this.original_model_data.traverse((child) => { child.castShadow = true })

    this.pre_rigged_skinned_meshes = skinned
    this.pre_rigged_skeleton = skeleton
    this.pre_rigged_root = loaded_scene
    // Only overwrite final_mesh_data when we're actually short-circuiting
    // the flow. In silent-cache mode the normal flow needs the stripped
    // scene reference downstream.
    if (dispatch) {
      this.final_mesh_data = loaded_scene as Scene
      this.dispatchEvent(new CustomEvent('modelLoadedPreRigged'))
    }
    return true
  }
  // [BICHITOS-FORK] end -------------------------------------------------

  public model_meshes (): Scene {
    // if the scene has some children in it, that means we already built it
    // this function gets called when we enter the application
    if (this.final_mesh_data.children.length > 0) {
      return this.final_mesh_data
    }

    // create a new scene object, and only include meshes
    const new_scene = new Scene()
    new_scene.name = this.model_display_name

    // do a for loop to add all the meshes to the scene from the geometry and material list
    for (let i = 0; i < this.geometry_list.length; i++) {
      const mesh = new Mesh(this.geometry_list[i], this.material_list[i])
      new_scene.add(mesh)
    }

    this.final_mesh_data = new_scene

    return this.final_mesh_data
  }

  public models_geometry_list (): BufferGeometry[] {
    // loop through final mesh data and return the geometeries
    const geometries_to_return: BufferGeometry[] = []
    this.final_mesh_data.traverse((child) => {
      if (child.type === 'Mesh') {
        geometries_to_return.push((child as Mesh).geometry.clone())
      }
    })

    return geometries_to_return
  }

  public models_material_list (): Material[] {
    return this.material_list
  }

  /**
   * Rotate all geometry data in the model by the given angle (in degrees) around the specified axis.
   * This directly modifies the geometry vertices.
   */
  public rotate_model_geometry (axis: 'x' | 'y' | 'z', angle: number): void {
    const radians = MathUtils.degToRad(angle)
    this.final_mesh_data.traverse((obj: Object3D) => {
      if (obj.type === 'Mesh') {
        const mesh = obj as Mesh
        mesh.geometry.rotateX(axis === 'x' ? radians : 0)
        mesh.geometry.rotateY(axis === 'y' ? radians : 0)
        mesh.geometry.rotateZ(axis === 'z' ? radians : 0)
        mesh.geometry.computeBoundingBox()
        mesh.geometry.computeBoundingSphere()
      }
    })
  }
}
