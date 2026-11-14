//! Stable groups of visible instances sharing a model mesh.

use std::collections::HashMap;
use std::ops::Range;

pub(crate) struct ModelBatch {
    pub mesh_id: String,
    pub instances: Range<u32>,
}

#[derive(Default)]
pub(crate) struct ModelBatches {
    pub indices: Vec<u32>,
    pub batches: Vec<ModelBatch>,
}

impl ModelBatches {
    pub fn build(draws: &[(String, u32)], visible: impl Fn(usize) -> bool) -> Self {
        let mut lookup = HashMap::<&str, usize>::new();
        let mut groups: Vec<(&str, Vec<u32>)> = Vec::new();
        for (id, index) in draws {
            if !visible(*index as usize) {
                continue;
            }
            let group = *lookup.entry(id.as_str()).or_insert_with(|| {
                let group = groups.len();
                groups.push((id.as_str(), Vec::new()));
                group
            });
            groups[group].1.push(*index);
        }

        let mut result = Self::default();
        for (id, indices) in groups {
            let start = result.indices.len() as u32;
            result.indices.extend(indices);
            result.batches.push(ModelBatch {
                mesh_id: id.to_owned(),
                instances: start..result.indices.len() as u32,
            });
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::ModelBatches;

    #[test]
    fn groups_visible_instances_without_losing_original_indices() {
        let draws = vec![("a".into(), 3), ("b".into(), 1), ("a".into(), 8), ("b".into(), 5)];
        let batches = ModelBatches::build(&draws, |index| index != 1);
        assert_eq!(batches.indices, [3, 8, 5]);
        assert_eq!(batches.batches.len(), 2);
        assert_eq!(batches.batches[0].mesh_id, "a");
        assert_eq!(batches.batches[0].instances, 0..2);
        assert_eq!(batches.batches[1].mesh_id, "b");
        assert_eq!(batches.batches[1].instances, 2..3);
        assert!(ModelBatches::build(&draws, |_| false).batches.is_empty());
    }
}
