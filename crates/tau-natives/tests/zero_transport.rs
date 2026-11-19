//! Integration test for Zero-Transport Shared-Memory Pipeline
//! Tests the FFI bindings between tau-natives and libzero_transport.so

use std::ffi::c_void;

// FFI declarations matching the Zero-Transport C library
#[allow(dead_code)]
unsafe extern "C" {
	fn zt_alloc(ring_bytes: i32) -> *mut ZtHandle;
	fn zt_free(handle: *mut ZtHandle);
	fn zt_push(
		handle: *mut ZtHandle,
		payload: *const c_void,
		payload_len: u32,
		entity_id: u64,
		capability_bit: u32,
	) -> i32;
	fn zt_pop(
		handle: *mut ZtHandle,
		out: *mut c_void,
		out_cap: u32,
		entity_id: *mut u64,
		capability_bit: *mut u32,
	) -> i32;
	fn zt_ring_bytes(handle: *const ZtHandle) -> usize;
	fn zt_verify(frame: *const ZeroPolicyFrame, allowed_bitmap: u64) -> bool;
}

#[repr(C)]
struct ZtHandle {
	fd:         i32,
	vbase:      *mut u8,
	ring:       *mut ZtRing,
	ring_bytes: usize,
}

#[repr(C)]
struct ZtRing {
	head:     u64,
	tail:     u64,
	reserved: [u64; 6],
	data:     [u8; 65536],
}

#[repr(C)]
struct ZeroPolicyFrame {
	record_hdr:     u64,
	magic_opcode:   u64,
	entity_id:      u64,
	payload_len:    u32,
	capability_bit: u32,
	payload:        [u8; 32],
}

#[test]
fn test_zero_transport_alloc_free() {
	let handle = unsafe { zt_alloc(65536) };
	assert!(!handle.is_null(), "Failed to allocate Zero-Transport ring");

	let ring_bytes = unsafe { zt_ring_bytes(handle) };
	assert_eq!(ring_bytes, 65536, "Ring size mismatch");

	unsafe { zt_free(handle) };
}

#[test]
fn test_zero_transport_push_pop() {
	let handle = unsafe { zt_alloc(65536) };
	assert!(!handle.is_null(), "Failed to allocate Zero-Transport ring");

	// Push test payload
	let payload = b"Hello, Zero-Transport!";
	let result = unsafe {
		zt_push(
			handle,
			payload.as_ptr() as *const c_void,
			payload.len() as u32,
			8932201107, // Bot entity ID
			0,
		)
	};
	assert!(result >= 0, "Failed to push to Zero-Transport ring: {}", result);
	assert_eq!(result as usize, payload.len(), "Push size mismatch");

	// Pop the payload
	let mut buffer = [0u8; 64];
	let mut entity_id: u64 = 0;
	let mut capability_bit: u32 = 0;

	let result = unsafe {
		zt_pop(
			handle,
			buffer.as_mut_ptr() as *mut c_void,
			buffer.len() as u32,
			&mut entity_id,
			&mut capability_bit,
		)
	};
	assert!(result >= 0, "Failed to pop from Zero-Transport ring: {}", result);
	assert_eq!(result as usize, payload.len(), "Pop size mismatch");

	// Verify payload matches
	assert_eq!(&buffer[..result as usize], payload, "Payload mismatch");
	assert_eq!(entity_id, 8932201107, "Entity ID mismatch");

	unsafe { zt_free(handle) };
}

#[test]
fn test_zero_transport_policy_verification() {
	let handle = unsafe { zt_alloc(65536) };
	assert!(!handle.is_null(), "Failed to allocate Zero-Transport ring");

	// Push a payload and verify it
	let payload = b"Test message";
	let result =
		unsafe { zt_push(handle, payload.as_ptr() as *const c_void, payload.len() as u32, 12345, 0) };
	assert!(result >= 0, "Failed to push to Zero-Transport ring");

	unsafe { zt_free(handle) };
}
